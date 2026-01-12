import { randomUUID } from 'node:crypto';

import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';

import { config } from '../config/index.js';

import { runWithRequestContext } from '../services/context.js';
import { logDebug } from '../services/logger.js';

import { normalizeHost } from '../utils/host-normalizer.js';

import { getSessionId } from './mcp-sessions.js';

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
