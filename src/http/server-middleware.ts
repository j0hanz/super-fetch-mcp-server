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

import {
  createHostValidationMiddleware,
  createOriginValidationMiddleware,
} from './host-allowlist.js';
import { getSessionId } from './sessions.js';

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
      sessionId === undefined ? { requestId } : { requestId, sessionId };

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
