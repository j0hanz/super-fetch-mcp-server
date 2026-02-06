import { logDebug } from './observability.js';

export interface HttpServerTuningTarget {
  headersTimeout?: number;
  requestTimeout?: number;
  keepAliveTimeout?: number;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function applyHttpServerTuning(_server: HttpServerTuningTarget): void {
  // No-op for now; placeholder for future tuning parameters.
}

export function drainConnectionsOnShutdown(
  server: HttpServerTuningTarget
): void {
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
    logDebug('Closed idle HTTP connections during shutdown');
  }
}
