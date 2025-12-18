import { config } from '../config/index.js';

function formatMeta(meta?: Record<string, unknown>): string {
  return meta ? ` ${JSON.stringify(meta)}` : '';
}

function getTimestamp(): string {
  return new Date().toISOString();
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (config.logging.enabled) {
    console.log(`[${getTimestamp()}] INFO: ${message}${formatMeta(meta)}`);
  }
}

export function logDebug(
  message: string,
  meta?: Record<string, unknown>
): void {
  if (config.logging.enabled && config.logging.level === 'debug') {
    console.debug(`[${getTimestamp()}] DEBUG: ${message}${formatMeta(meta)}`);
  }
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  if (config.logging.enabled) {
    console.warn(`[${getTimestamp()}] WARN: ${message}${formatMeta(meta)}`);
  }
}

export function logError(
  message: string,
  error?: Error | Record<string, unknown>
): void {
  if (!config.logging.enabled) return;

  const errorMeta =
    error instanceof Error
      ? { error: error.message, stack: error.stack }
      : error;
  console.error(
    `[${getTimestamp()}] ERROR: ${message}${formatMeta(errorMeta)}`
  );
}
