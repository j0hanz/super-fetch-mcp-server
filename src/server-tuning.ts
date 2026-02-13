import { config } from './config.js';
import { logDebug, logWarn } from './observability.js';

interface HttpServerTuningTarget {
  headersTimeout?: number;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  keepAliveTimeoutBuffer?: number;
  maxHeadersCount?: number | null;
  maxConnections?: number;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

const DROP_LOG_INTERVAL_MS = 10_000;

function setIfDefined<T>(
  value: T | undefined,
  setter: (resolved: T) => void
): void {
  if (value === undefined) return;
  setter(value);
}

export function applyHttpServerTuning(server: HttpServerTuningTarget): void {
  const {
    headersTimeoutMs,
    requestTimeoutMs,
    keepAliveTimeoutMs,
    keepAliveTimeoutBufferMs,
    maxHeadersCount,
    maxConnections,
  } = config.server.http;

  setIfDefined(headersTimeoutMs, (value) => {
    server.headersTimeout = value;
  });
  setIfDefined(requestTimeoutMs, (value) => {
    server.requestTimeout = value;
  });
  setIfDefined(keepAliveTimeoutMs, (value) => {
    server.keepAliveTimeout = value;
  });
  setIfDefined(keepAliveTimeoutBufferMs, (value) => {
    server.keepAliveTimeoutBuffer = value;
  });
  setIfDefined(maxHeadersCount, (value) => {
    server.maxHeadersCount = value;
  });

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
