import { config } from '../config/index.js';
import type { LogLevel, LogMetadata } from '../config/types/runtime.js';

import { getOperationId, getRequestId, getSessionId } from './context.js';

function formatMetadata(meta?: LogMetadata): string {
  const requestId = getRequestId();
  const sessionId = getSessionId();
  const operationId = getOperationId();

  const contextMeta: LogMetadata = {};
  if (requestId) contextMeta.requestId = requestId;
  if (sessionId) contextMeta.sessionId = sessionId;
  if (operationId) contextMeta.operationId = operationId;

  const merged = { ...contextMeta, ...meta };
  return Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : '';
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function formatLogEntry(
  level: LogLevel,
  message: string,
  meta?: LogMetadata
): string {
  return `[${createTimestamp()}] ${level.toUpperCase()}: ${message}${formatMetadata(meta)}`;
}

function shouldLog(level: LogLevel): boolean {
  // Debug logs only when LOG_LEVEL=debug
  if (level === 'debug') return config.logging.level === 'debug';
  // All other levels always log
  return true;
}

export function logInfo(message: string, meta?: LogMetadata): void {
  if (shouldLog('info')) {
    process.stderr.write(`${formatLogEntry('info', message, meta)}\n`);
  }
}

export function logDebug(message: string, meta?: LogMetadata): void {
  if (shouldLog('debug')) {
    process.stderr.write(`${formatLogEntry('debug', message, meta)}\n`);
  }
}

export function logWarn(message: string, meta?: LogMetadata): void {
  if (shouldLog('warn')) {
    process.stderr.write(`${formatLogEntry('warn', message, meta)}\n`);
  }
}

export function logError(message: string, error?: Error | LogMetadata): void {
  if (!shouldLog('error')) return;

  const errorMeta: LogMetadata =
    error instanceof Error
      ? { error: error.message, stack: error.stack }
      : (error ?? {});

  process.stderr.write(`${formatLogEntry('error', message, errorMeta)}\n`);
}
