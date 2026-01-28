import { config } from './config.js';
import { logDebug } from './observability.js';

export interface HttpServerTuningTarget {
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
    }
    return;
  }

  if (shutdownCloseIdleConnections) {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
      logDebug('Closed idle HTTP connections during shutdown');
    }
  }
}
