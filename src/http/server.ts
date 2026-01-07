import type { Express, RequestHandler } from 'express';

import { config, enableHttpMode } from '../config/index.js';

import { destroyAgents } from '../services/fetcher/agents.js';
import { logError, logInfo, logWarn } from '../services/logger.js';

import { errorHandler } from '../middleware/error-handler.js';

import { getErrorMessage } from '../utils/error-utils.js';

import { createAuthMetadataRouter, createAuthMiddleware } from './auth.js';
import { createCorsMiddleware } from './cors.js';
import { registerDownloadRoutes } from './download-routes.js';
import { registerMcpRoutes } from './mcp-routes.js';
import { createRateLimitMiddleware } from './rate-limit.js';
import { attachBaseMiddleware } from './server-middleware.js';
import { startSessionCleanupLoop } from './session-cleanup.js';
import { createSessionStore } from './sessions.js';

function assertHttpConfiguration(): void {
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

  if (config.security.allowRemote && config.auth.mode !== 'oauth') {
    logError(
      'Remote HTTP mode requires OAuth configuration; refusing to start'
    );
    process.exit(1);
  }

  if (config.auth.mode === 'static' && config.auth.staticTokens.length === 0) {
    logError('At least one static access token is required for HTTP mode');
    process.exit(1);
  }

  if (config.auth.mode === 'oauth') {
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

function createShutdownHandler(
  server: ReturnType<Express['listen']>,
  sessionStore: ReturnType<typeof createSessionStore>,
  sessionCleanupController: AbortController,
  stopRateLimitCleanup: () => void
): (signal: string) => Promise<void> {
  return async (signal: string): Promise<void> => {
    logInfo(`${signal} received, shutting down gracefully...`);

    stopRateLimitCleanup();
    sessionCleanupController.abort();

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

    destroyAgents();

    server.close(() => {
      logInfo('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logError('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  };
}

function registerSignalHandlers(
  shutdown: (signal: string) => Promise<void>
): void {
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
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

export async function startHttpServer(): Promise<{
  shutdown: (signal: string) => Promise<void>;
}> {
  enableHttpMode();

  const { app, jsonParser } = await createExpressApp();
  const {
    rateLimitMiddleware,
    stopRateLimitCleanup,
    authMiddleware,
    corsMiddleware,
  } = buildMiddleware();

  attachBaseMiddleware(app, jsonParser, rateLimitMiddleware, corsMiddleware);

  const authMetadataRouter = createAuthMetadataRouter();
  if (authMetadataRouter) {
    app.use(authMetadataRouter);
  }
  assertHttpConfiguration();

  const { sessionStore, sessionCleanupController } =
    createSessionInfrastructure();
  registerHttpRoutes(app, sessionStore, authMiddleware);

  const server = startListening(app);
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
