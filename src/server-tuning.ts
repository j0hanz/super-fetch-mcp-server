import { config } from './config.js';
import { logDebug, logWarn } from './observability.js';

export interface HttpServerTuningTarget {
  headersTimeout?: number;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  maxConnections?: number;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

const DROP_LOG_INTERVAL_MS = 10_000;

export function applyHttpServerTuning(server: HttpServerTuningTarget): void {
  const { maxConnections } = config.server.http;

  if (typeof maxConnections === 'number' && maxConnections > 0) {
    server.maxConnections = maxConnections;

    if (typeof server.on === 'function') {
      let lastLoggedAt = 0;
      let droppedSinceLastLog = 0;

      server.on('drop', (data: unknown) => {
        droppedSinceLastLog += 1;
        const now = Date.now();
        if (now - lastLoggedAt < DROP_LOG_INTERVAL_MS) return;

        logWarn('Incoming connection dropped (maxConnections reached)', {
          maxConnections,
          dropped: droppedSinceLastLog,
          data,
        });

        lastLoggedAt = now;
        droppedSinceLastLog = 0;
      });
    }
  }
}

export function drainConnectionsOnShutdown(
  server: HttpServerTuningTarget
): void {
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
    logDebug('Closed idle HTTP connections during shutdown');
  }
}
