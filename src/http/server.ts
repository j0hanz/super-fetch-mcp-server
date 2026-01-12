import { randomUUID } from 'node:crypto';
import { setInterval as setIntervalPromise } from 'node:timers/promises';

import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

import { config, enableHttpMode } from '../config/index.js';
import type { CacheEntry } from '../config/types/content.js';
import type {
  RateLimitEntry,
  RateLimiterOptions,
} from '../config/types/runtime.js';
import type { ErrorResponse } from '../config/types/tools.js';

import { FetchError } from '../errors/app-error.js';

import * as cache from '../services/cache.js';
import { runWithRequestContext } from '../services/context.js';
import { destroyAgents } from '../services/fetcher.js';
import { logDebug, logError, logInfo, logWarn } from '../services/logger.js';
import { shutdownTransformWorkerPool } from '../services/transform-worker-pool.js';

import {
  parseCachedPayload,
  resolveCachedPayloadContent,
} from '../utils/cached-payload.js';
import { getErrorMessage } from '../utils/error-details.js';
import { generateSafeFilename } from '../utils/filename-generator.js';
import { normalizeHost } from '../utils/host-normalizer.js';

import { createAuthMetadataRouter, createAuthMiddleware } from './auth.js';
import { registerMcpRoutes } from './mcp-routes.js';
import {
  createSessionStore,
  getSessionId,
  type SessionStore,
  startSessionCleanupLoop,
} from './mcp-sessions.js';

interface HttpServerTuningTarget {
  headersTimeout?: number;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export function applyHttpServerTuning(server: HttpServerTuningTarget): void {
  const { headersTimeoutMs, requestTimeoutMs, keepAliveTimeoutMs } =
    config.server.http;

  if (headersTimeoutMs !== undefined) {
    server.headersTimeout = headersTimeoutMs;
  }
  if (requestTimeoutMs !== undefined) {
    server.requestTimeout = requestTimeoutMs;
  }
  if (keepAliveTimeoutMs !== undefined) {
    server.keepAliveTimeout = keepAliveTimeoutMs;
  }

  if (
    headersTimeoutMs !== undefined ||
    requestTimeoutMs !== undefined ||
    keepAliveTimeoutMs !== undefined
  ) {
    logDebug('Applied HTTP server tuning', {
      headersTimeoutMs,
      requestTimeoutMs,
      keepAliveTimeoutMs,
    });
  }
}

export function drainConnectionsOnShutdown(
  server: HttpServerTuningTarget
): void {
  const { shutdownCloseAllConnections, shutdownCloseIdleConnections } =
    config.server.http;

  if (shutdownCloseAllConnections) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
      logDebug('Closed all HTTP connections during shutdown');
    } else {
      logDebug('HTTP server does not support closeAllConnections()');
    }
    return;
  }

  if (shutdownCloseIdleConnections) {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
      logDebug('Closed idle HTTP connections during shutdown');
    } else {
      logDebug('HTTP server does not support closeIdleConnections()');
    }
  }
}

interface RateLimitConfig extends RateLimiterOptions {
  enabled: boolean;
}

interface RateLimitMiddlewareResult {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  stop: () => void;
  store: Map<string, RateLimitEntry>;
}

function getRateLimitKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function createCleanupInterval(
  store: Map<string, RateLimitEntry>,
  options: RateLimitConfig
): AbortController {
  const controller = new AbortController();

  void startCleanupLoop(store, options, controller.signal).catch(
    handleCleanupError
  );

  return controller;
}

function createRateLimitMiddleware(
  options: RateLimitConfig
): RateLimitMiddlewareResult {
  const store = new Map<string, RateLimitEntry>();
  const cleanupController = createCleanupInterval(store, options);
  const stop = (): void => {
    cleanupController.abort();
  };
  const middleware = createRateLimitHandler(store, options);

  return { middleware, stop, store };
}

function createRateLimitHandler(
  store: Map<string, RateLimitEntry>,
  options: RateLimitConfig
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (shouldSkipRateLimit(req, options)) {
      next();
      return;
    }

    const now = Date.now();
    const key = getRateLimitKey(req);
    const resolution = resolveRateLimitEntry(store, key, now, options);

    if (resolution.isNew) {
      next();
      return;
    }

    if (handleRateLimitExceeded(res, resolution.entry, now, options)) {
      return;
    }

    next();
  };
}

async function startCleanupLoop(
  store: Map<string, RateLimitEntry>,
  options: RateLimitConfig,
  signal: AbortSignal
): Promise<void> {
  for await (const getNow of setIntervalPromise(
    options.cleanupIntervalMs,
    Date.now,
    { signal, ref: false }
  )) {
    evictStaleEntries(store, options, getNow());
  }
}

function evictStaleEntries(
  store: Map<string, RateLimitEntry>,
  options: RateLimitConfig,
  now: number
): void {
  for (const [key, entry] of store.entries()) {
    if (now - entry.lastAccessed > options.windowMs * 2) {
      store.delete(key);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function handleCleanupError(error: unknown): void {
  if (isAbortError(error)) {
    return;
  }
}

function shouldSkipRateLimit(req: Request, options: RateLimitConfig): boolean {
  return !options.enabled || req.method === 'OPTIONS';
}

function resolveRateLimitEntry(
  store: Map<string, RateLimitEntry>,
  key: string,
  now: number,
  options: RateLimitConfig
): { entry: RateLimitEntry; isNew: boolean } {
  const existing = store.get(key);
  if (!existing || now > existing.resetTime) {
    const entry = createNewEntry(now, options);
    store.set(key, entry);
    return { entry, isNew: true };
  }

  updateEntry(existing, now);
  return { entry: existing, isNew: false };
}

function createNewEntry(now: number, options: RateLimitConfig): RateLimitEntry {
  return {
    count: 1,
    resetTime: now + options.windowMs,
    lastAccessed: now,
  };
}

function updateEntry(entry: RateLimitEntry, now: number): void {
  entry.count += 1;
  entry.lastAccessed = now;
}

function handleRateLimitExceeded(
  res: Response,
  entry: RateLimitEntry,
  now: number,
  options: RateLimitConfig
): boolean {
  if (entry.count <= options.maxRequests) {
    return false;
  }

  const retryAfter = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    error: 'Rate limit exceeded',
    retryAfter,
  });
  return true;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function getNonEmptyStringHeader(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function respondHostNotAllowed(res: Response): void {
  res.status(403).json({
    error: 'Host not allowed',
    code: 'HOST_NOT_ALLOWED',
  });
}

function respondOriginNotAllowed(res: Response): void {
  res.status(403).json({
    error: 'Origin not allowed',
    code: 'ORIGIN_NOT_ALLOWED',
  });
}

function tryParseOriginHostname(originHeader: string): string | null {
  try {
    return new URL(originHeader).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

function addLoopbackHosts(allowedHosts: Set<string>): void {
  for (const host of LOOPBACK_HOSTS) {
    allowedHosts.add(host);
  }
}

function addConfiguredHost(allowedHosts: Set<string>): void {
  const configuredHost = normalizeHost(config.server.host);
  if (!configuredHost) return;
  if (isWildcardHost(configuredHost)) return;
  allowedHosts.add(configuredHost);
}

function addExplicitAllowedHosts(allowedHosts: Set<string>): void {
  for (const host of config.security.allowedHosts) {
    const normalized = normalizeHost(host);
    if (!normalized) {
      logDebug('Ignoring invalid allowed host entry', { host });
      continue;
    }
    allowedHosts.add(normalized);
  }
}

function buildAllowedHosts(): Set<string> {
  const allowedHosts = new Set<string>();

  addLoopbackHosts(allowedHosts);
  addConfiguredHost(allowedHosts);
  addExplicitAllowedHosts(allowedHosts);

  return allowedHosts;
}

function createHostValidationMiddleware(): RequestHandler {
  const allowedHosts = buildAllowedHosts();

  return (req: Request, res: Response, next: NextFunction): void => {
    const hostHeader =
      typeof req.headers.host === 'string' ? req.headers.host : '';

    const normalized = normalizeHost(hostHeader);

    if (!normalized || !allowedHosts.has(normalized)) {
      respondHostNotAllowed(res);
      return;
    }

    next();
  };
}

function createOriginValidationMiddleware(): RequestHandler {
  const allowedHosts = buildAllowedHosts();

  return (req: Request, res: Response, next: NextFunction): void => {
    const originHeader = getNonEmptyStringHeader(req.headers.origin);
    if (!originHeader) {
      next();
      return;
    }

    const originHostname = tryParseOriginHostname(originHeader);
    if (!originHostname || !allowedHosts.has(originHostname)) {
      respondOriginNotAllowed(res);
      return;
    }

    next();
  };
}

function createJsonParseErrorHandler(): (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (
    err: Error,
    _req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON',
        },
        id: null,
      });
      return;
    }
    next();
  };
}

function createContextMiddleware(): (
  req: Request,
  _res: Response,
  next: NextFunction
) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    const sessionId = getSessionId(req);

    const context =
      sessionId === undefined
        ? { requestId, operationId: requestId }
        : { requestId, operationId: requestId, sessionId };

    runWithRequestContext(context, () => {
      next();
    });
  };
}

export function createCorsMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  };
}

function registerHealthRoute(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      name: config.server.name,
      version: config.server.version,
      uptime: process.uptime(),
    });
  });
}

export function attachBaseMiddleware(options: {
  app: Express;
  jsonParser: RequestHandler;
  rateLimitMiddleware: RequestHandler;
  corsMiddleware: RequestHandler;
}): void {
  const { app, jsonParser, rateLimitMiddleware, corsMiddleware } = options;
  app.use(createHostValidationMiddleware());
  app.use(createOriginValidationMiddleware());
  app.use(jsonParser);
  app.use(createContextMiddleware());
  app.use(createJsonParseErrorHandler());
  app.use(corsMiddleware);
  app.use('/mcp', rateLimitMiddleware);
  registerHealthRoute(app);
}

const HASH_PATTERN = /^[a-f0-9.]+$/i;

interface DownloadParams {
  namespace: string;
  hash: string;
}

interface DownloadPayload {
  content: string;
  contentType: string;
  fileName: string;
}

function validateNamespace(namespace: string): boolean {
  return namespace === 'markdown';
}

function validateHash(hash: string): boolean {
  return HASH_PATTERN.test(hash) && hash.length >= 8 && hash.length <= 64;
}

function parseDownloadParams(req: Request): DownloadParams | null {
  const { namespace, hash } = req.params;

  if (!namespace || !hash) return null;
  if (!validateNamespace(namespace)) return null;
  if (!validateHash(hash)) return null;

  return { namespace, hash };
}

function buildCacheKeyFromParams(params: DownloadParams): string {
  return `${params.namespace}:${params.hash}`;
}

function respondBadRequest(res: Response, message: string): void {
  res.status(400).json({
    error: message,
    code: 'BAD_REQUEST',
  });
}

function respondNotFound(res: Response): void {
  res.status(404).json({
    error: 'Content not found or expired',
    code: 'NOT_FOUND',
  });
}

function respondServiceUnavailable(res: Response): void {
  res.status(503).json({
    error: 'Download service is disabled',
    code: 'SERVICE_UNAVAILABLE',
  });
}

function resolveDownloadPayload(
  params: DownloadParams,
  cacheEntry: CacheEntry
): DownloadPayload | null {
  const payload = parseCachedPayload(cacheEntry.content);
  if (!payload) return null;

  const content = resolveCachedPayloadContent(payload);
  if (!content) return null;

  const safeTitle =
    typeof payload.title === 'string' ? payload.title : undefined;
  const fileName = generateSafeFilename(
    cacheEntry.url,
    cacheEntry.title ?? safeTitle,
    params.hash,
    '.md'
  );

  return {
    content,
    contentType: 'text/markdown; charset=utf-8',
    fileName,
  };
}

function buildContentDisposition(fileName: string): string {
  const encodedName = encodeURIComponent(fileName).replace(/'/g, '%27');
  return `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`;
}

function sendDownloadPayload(res: Response, payload: DownloadPayload): void {
  const disposition = buildContentDisposition(payload.fileName);
  res.setHeader('Content-Type', payload.contentType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', `private, max-age=${config.cache.ttl}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(payload.content);
}

function handleDownload(req: Request, res: Response): void {
  if (!config.cache.enabled) {
    respondServiceUnavailable(res);
    return;
  }

  const params = parseDownloadParams(req);
  if (!params) {
    respondBadRequest(res, 'Invalid namespace or hash format');
    return;
  }

  const cacheKey = buildCacheKeyFromParams(params);
  const cacheEntry = cache.get(cacheKey);

  if (!cacheEntry) {
    logDebug('Download request for missing cache key', { cacheKey });
    respondNotFound(res);
    return;
  }

  const payload = resolveDownloadPayload(params, cacheEntry);
  if (!payload) {
    logDebug('Download payload unavailable', { cacheKey });
    respondNotFound(res);
    return;
  }

  logDebug('Serving download', { cacheKey, fileName: payload.fileName });
  sendDownloadPayload(res, payload);
}

export function registerDownloadRoutes(app: Express): void {
  app.get('/mcp/downloads/:namespace/:hash', handleDownload);
}

function getStatusCode(fetchError: FetchError | null): number {
  return fetchError ? fetchError.statusCode : 500;
}

function getErrorCode(fetchError: FetchError | null): string {
  return fetchError ? fetchError.code : 'INTERNAL_ERROR';
}

function getFetchErrorMessage(fetchError: FetchError | null): string {
  return fetchError ? fetchError.message : 'Internal Server Error';
}

function getErrorDetails(
  fetchError: FetchError | null
): Record<string, unknown> | undefined {
  if (fetchError && Object.keys(fetchError.details).length > 0) {
    return fetchError.details;
  }
  return undefined;
}

function setRetryAfterHeader(
  res: Response,
  fetchError: FetchError | null
): void {
  const retryAfter = resolveRetryAfter(fetchError);
  if (retryAfter === undefined) return;
  res.set('Retry-After', retryAfter);
}

function buildErrorResponse(fetchError: FetchError | null): ErrorResponse {
  const details = getErrorDetails(fetchError);
  const response: ErrorResponse = {
    error: {
      message: getFetchErrorMessage(fetchError),
      code: getErrorCode(fetchError),
      statusCode: getStatusCode(fetchError),
      ...(details && { details }),
    },
  };

  // Never expose stack traces in production
  return response;
}

function resolveRetryAfter(fetchError: FetchError | null): string | undefined {
  if (fetchError?.statusCode !== 429) return undefined;

  const { retryAfter } = fetchError.details;
  return isRetryAfterValue(retryAfter) ? String(retryAfter) : undefined;
}

function isRetryAfterValue(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'string';
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const fetchError = err instanceof FetchError ? err : null;
  const statusCode = getStatusCode(fetchError);

  logError(
    `HTTP ${statusCode}: ${err.message} - ${req.method} ${req.path}`,
    err
  );

  setRetryAfterHeader(res, fetchError);

  res.status(statusCode).json(buildErrorResponse(fetchError));
}

function assertHttpConfiguration(): void {
  ensureBindAllowed();
  ensureStaticTokens();
  if (config.auth.mode === 'oauth') {
    ensureOauthConfiguration();
  }
}

function ensureBindAllowed(): void {
  const isLoopback = ['127.0.0.1', '::1', 'localhost'].includes(
    config.server.host
  );
  if (!config.security.allowRemote && !isLoopback) {
    logError(
      'Refusing to bind to non-loopback host without ALLOW_REMOTE=true',
      { host: config.server.host }
    );
    process.exit(1);
  }

  if (
    !isLoopback &&
    config.security.allowRemote &&
    config.auth.mode !== 'oauth'
  ) {
    logError(
      'Remote HTTP mode requires OAuth configuration; refusing to start'
    );
    process.exit(1);
  }
}

function ensureStaticTokens(): void {
  if (config.auth.mode === 'static' && config.auth.staticTokens.length === 0) {
    logError('At least one static access token is required for HTTP mode');
    process.exit(1);
  }
}

function ensureOauthConfiguration(): void {
  if (!config.auth.issuerUrl || !config.auth.authorizationUrl) {
    logError(
      'OAUTH_ISSUER_URL and OAUTH_AUTHORIZATION_URL are required for OAuth mode'
    );
    process.exit(1);
  }

  if (!config.auth.tokenUrl) {
    logError('OAUTH_TOKEN_URL is required for OAuth mode');
    process.exit(1);
  }

  if (!config.auth.introspectionUrl) {
    logError('OAUTH_INTROSPECTION_URL is required for OAuth mode');
    process.exit(1);
  }
}

function createShutdownHandler(
  server: ReturnType<Express['listen']>,
  sessionStore: SessionStore,
  sessionCleanupController: AbortController,
  stopRateLimitCleanup: () => void
): (signal: string) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let initialSignal: string | null = null;

  return (signal: string): Promise<void> => {
    if (inFlight) {
      logWarn('Shutdown already in progress; ignoring signal', {
        signal,
        initialSignal,
      });
      return inFlight;
    }

    initialSignal = signal;
    inFlight = shutdownServer(
      signal,
      server,
      sessionStore,
      sessionCleanupController,
      stopRateLimitCleanup
    ).catch((error: unknown) => {
      logError(
        'Shutdown handler failed',
        error instanceof Error ? error : { error: getErrorMessage(error) }
      );
      throw error;
    });

    return inFlight;
  };
}

async function shutdownServer(
  signal: string,
  server: ReturnType<Express['listen']>,
  sessionStore: SessionStore,
  sessionCleanupController: AbortController,
  stopRateLimitCleanup: () => void
): Promise<void> {
  logInfo(`${signal} received, shutting down gracefully...`);

  stopRateLimitCleanup();
  sessionCleanupController.abort();

  await closeSessions(sessionStore);
  destroyAgents();
  await shutdownTransformWorkerPool();
  drainConnectionsOnShutdown(server);
  closeServer(server);
  scheduleForcedShutdown(10000);
}

async function closeSessions(sessionStore: SessionStore): Promise<void> {
  const sessions = sessionStore.clear();
  await Promise.allSettled(
    sessions.map((session) =>
      session.transport.close().catch((error: unknown) => {
        logWarn('Failed to close session during shutdown', {
          error: getErrorMessage(error),
        });
      })
    )
  );
}

function closeServer(server: ReturnType<Express['listen']>): void {
  server.close(() => {
    logInfo('HTTP server closed');
    process.exit(0);
  });
}

function scheduleForcedShutdown(timeoutMs: number): void {
  setTimeout(() => {
    logError('Forced shutdown after timeout');
    process.exit(1);
  }, timeoutMs).unref();
}

function registerSignalHandlers(
  shutdown: (signal: string) => Promise<void>
): void {
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function startListening(app: Express): ReturnType<Express['listen']> {
  return app
    .listen(config.server.port, config.server.host, () => {
      logInfo('superFetch MCP server started', {
        host: config.server.host,
        port: config.server.port,
      });

      const baseUrl = `http://${config.server.host}:${config.server.port}`;
      logInfo(
        `superFetch MCP server running at ${baseUrl} (health: ${baseUrl}/health, mcp: ${baseUrl}/mcp)`
      );
      logInfo('Run with --stdio flag for direct stdio integration');
    })
    .on('error', (err) => {
      logError('Failed to start server', err);
      process.exit(1);
    });
}

function buildMiddleware(): {
  rateLimitMiddleware: RequestHandler;
  stopRateLimitCleanup: () => void;
  authMiddleware: RequestHandler;
  corsMiddleware: RequestHandler;
} {
  const { middleware: rateLimitMiddleware, stop: stopRateLimitCleanup } =
    createRateLimitMiddleware(config.rateLimit);
  const authMiddleware = createAuthMiddleware();
  // No CORS - MCP clients don't run in browsers
  const corsMiddleware = createCorsMiddleware();

  return {
    rateLimitMiddleware,
    stopRateLimitCleanup,
    authMiddleware,
    corsMiddleware,
  };
}

function createSessionInfrastructure(): {
  sessionStore: ReturnType<typeof createSessionStore>;
  sessionCleanupController: AbortController;
} {
  const sessionStore = createSessionStore(config.server.sessionTtlMs);
  const sessionCleanupController = startSessionCleanupLoop(
    sessionStore,
    config.server.sessionTtlMs
  );
  return { sessionStore, sessionCleanupController };
}

function registerHttpRoutes(
  app: Express,
  sessionStore: ReturnType<typeof createSessionStore>,
  authMiddleware: RequestHandler
): void {
  app.use('/mcp', authMiddleware);
  app.use('/mcp/downloads', authMiddleware);
  registerMcpRoutes(app, {
    sessionStore,
    maxSessions: config.server.maxSessions,
  });
  registerDownloadRoutes(app);
  app.use(errorHandler);
}

function attachAuthMetadata(app: Express): void {
  const authMetadataRouter = createAuthMetadataRouter();
  if (authMetadataRouter) {
    app.use(authMetadataRouter);
  }
}

async function buildServerContext(): Promise<{
  app: Express;
  sessionStore: ReturnType<typeof createSessionStore>;
  sessionCleanupController: AbortController;
  stopRateLimitCleanup: () => void;
}> {
  const { app, authMiddleware, stopRateLimitCleanup } =
    await createAppWithMiddleware();
  const { sessionStore, sessionCleanupController } = attachSessionRoutes(
    app,
    authMiddleware
  );
  return { app, sessionStore, sessionCleanupController, stopRateLimitCleanup };
}

async function createAppWithMiddleware(): Promise<{
  app: Express;
  authMiddleware: RequestHandler;
  stopRateLimitCleanup: () => void;
}> {
  const { app, jsonParser } = await createExpressApp();
  const {
    rateLimitMiddleware,
    stopRateLimitCleanup,
    authMiddleware,
    corsMiddleware,
  } = buildMiddleware();

  attachBaseMiddleware({
    app,
    jsonParser,
    rateLimitMiddleware,
    corsMiddleware,
  });
  attachAuthMetadata(app);
  assertHttpConfiguration();

  return { app, authMiddleware, stopRateLimitCleanup };
}

function attachSessionRoutes(
  app: Express,
  authMiddleware: RequestHandler
): {
  sessionStore: ReturnType<typeof createSessionStore>;
  sessionCleanupController: AbortController;
} {
  const { sessionStore, sessionCleanupController } =
    createSessionInfrastructure();
  registerHttpRoutes(app, sessionStore, authMiddleware);
  return { sessionStore, sessionCleanupController };
}

export async function startHttpServer(): Promise<{
  shutdown: (signal: string) => Promise<void>;
}> {
  enableHttpMode();
  const { app, sessionStore, sessionCleanupController, stopRateLimitCleanup } =
    await buildServerContext();
  const server = startListening(app);
  applyHttpServerTuning(server);
  const shutdown = createShutdownHandler(
    server,
    sessionStore,
    sessionCleanupController,
    stopRateLimitCleanup
  );
  registerSignalHandlers(shutdown);
  return { shutdown };
}

async function createExpressApp(): Promise<{
  app: Express;
  jsonParser: RequestHandler;
}> {
  const { default: express } = await import('express');
  const app = express();
  const jsonParser = express.json({ limit: '1mb' });
  return { app, jsonParser };
}
