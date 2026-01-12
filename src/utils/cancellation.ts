import { FetchError } from '../errors/app-error.js';

function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'TimeoutError';
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  url: string,
  stage: string
): void {
  if (!signal?.aborted) return;

  if (isTimeoutReason((signal as unknown as { reason: unknown }).reason)) {
    throw new FetchError('Request timeout', url, 504, {
      reason: 'timeout',
      stage,
    });
  }

  throw new FetchError('Request was canceled', url, 499, {
    reason: 'aborted',
    stage,
  });
}
