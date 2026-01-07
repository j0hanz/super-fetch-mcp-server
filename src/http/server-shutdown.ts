import type { Express } from 'express';

import { destroyAgents } from '../services/fetcher/agents.js';
import { logError, logInfo, logWarn } from '../services/logger.js';

import { getErrorMessage } from '../utils/error-utils.js';

import type { SessionStore } from './sessions.js';

export function createShutdownHandler(
  server: ReturnType<Express['listen']>,
  sessionStore: SessionStore,
  sessionCleanupController: AbortController,
  stopRateLimitCleanup: () => void
): (signal: string) => Promise<void> {
  return (signal: string): Promise<void> =>
    shutdownServer(
      signal,
      server,
      sessionStore,
      sessionCleanupController,
      stopRateLimitCleanup
    );
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

export function registerSignalHandlers(
  shutdown: (signal: string) => Promise<void>
): void {
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}
