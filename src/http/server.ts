import { setInterval as setIntervalPromise } from 'node:timers/promises';

import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

import { config, enableHttpMode } from '../config/index.js';
import type {
  RateLimitEntry,
  RateLimiterOptions,
} from '../config/types/runtime.js';

import { destroyAgents } from '../services/fetcher.js';
import { logError, logInfo, logWarn } from '../services/logger.js';
import { shutdownTransformWorkerPool } from '../services/transform-worker-pool.js';

import { getErrorMessage } from '../utils/error-details.js';

import { createAuthMetadataRouter, createAuthMiddleware } from './auth.js';
import { attachBaseMiddleware } from './base-middleware.js';
import { createCorsMiddleware } from './cors.js';
import { registerDownloadRoutes } from './download-routes.js';
import { errorHandler } from './error-handler.js';
import { registerMcpRoutes } from './mcp-routes.js';
import {
  createSessionStore,
  type SessionStore,
  startSessionCleanupLoop,
} from './mcp-sessions.js';
import {
  applyHttpServerTuning,
  drainConnectionsOnShutdown,
} from './server-tuning.js';

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
