import { randomUUID } from 'node:crypto';
import diagnosticsChannel from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

import { isSystemError } from '../../utils/error-details.js';

import { logDebug, logError, logWarn } from '../logger.js';

type FetchChannelEvent =
  | {
      v: 1;
      type: 'start';
      requestId: string;
      method: string;
      url: string;
    }
  | {
      v: 1;
      type: 'end';
      requestId: string;
      status: number;
      duration: number;
    }
  | {
      v: 1;
      type: 'error';
      requestId: string;
      url: string;
      error: string;
      code?: string;
      status?: number;
      duration: number;
    };

const fetchChannel = diagnosticsChannel.channel('superfetch.fetch');

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function publishFetchEvent(event: FetchChannelEvent): void {
  if (!fetchChannel.hasSubscribers) return;
  try {
    fetchChannel.publish(event);
  } catch {
    // Avoid crashing the publisher if a subscriber throws.
  }
}

interface FetchTelemetryContext {
  requestId: string;
  startTime: number;
  url: string;
  method: string;
}

export function startFetchTelemetry(
  url: string,
  method: string
): FetchTelemetryContext {
  const safeUrl = redactUrl(url);
  const context: FetchTelemetryContext = {
    requestId: randomUUID(),
    startTime: performance.now(),
    url: safeUrl,
    method: method.toUpperCase(),
  };

  publishFetchEvent({
    v: 1,
    type: 'start',
    requestId: context.requestId,
    method: context.method,
    url: context.url,
  });

  logDebug('HTTP Request', {
    requestId: context.requestId,
    method: context.method,
    url: context.url,
  });

  return context;
}

export function recordFetchResponse(
  context: FetchTelemetryContext,
  response: Response,
  contentSize?: number
): void {
  const duration = performance.now() - context.startTime;
  const durationLabel = `${Math.round(duration)}ms`;
  publishFetchEvent({
    v: 1,
    type: 'end',
    requestId: context.requestId,
    status: response.status,
    duration,
  });

  const contentType = response.headers.get('content-type');
  const contentLength =
    response.headers.get('content-length') ??
    (contentSize === undefined ? undefined : String(contentSize));

  logDebug('HTTP Response', {
    requestId: context.requestId,
    status: response.status,
    url: context.url,
    duration: durationLabel,
    ...(contentType ? { contentType } : {}),
    ...(contentLength ? { size: contentLength } : {}),
  });

  if (duration > 5000) {
    logWarn('Slow HTTP request detected', {
      requestId: context.requestId,
      url: context.url,
      duration: durationLabel,
    });
  }
}

export function recordFetchError(
  context: FetchTelemetryContext,
  error: unknown,
  status?: number
): void {
  const duration = performance.now() - context.startTime;
  const err = error instanceof Error ? error : new Error(String(error));

  const event: FetchChannelEvent = {
    v: 1,
    type: 'error',
    requestId: context.requestId,
    url: context.url,
    error: err.message,
    duration,
  };

  const code = isSystemError(err) ? err.code : undefined;
  if (code !== undefined) {
    event.code = code;
  }
  if (status !== undefined) {
    event.status = status;
  }

  publishFetchEvent(event);

  const log = status === 429 ? logWarn : logError;
  log('HTTP Request Error', {
    requestId: context.requestId,
    url: context.url,
    status,
    code,
    error: err.message,
  });
}
