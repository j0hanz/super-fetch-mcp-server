import diagnosticsChannel from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

import { redactUrl } from '../utils/url-redactor.js';

import { getOperationId, getRequestId } from './context.js';

export interface TransformStageEvent {
  v: 1;
  type: 'stage';
  stage: string;
  durationMs: number;
  url: string;
  requestId?: string;
  operationId?: string;
  truncated?: boolean;
}

export interface TransformStageContext {
  readonly stage: string;
  readonly startTime: number;
  readonly url: string;
}

const transformChannel = diagnosticsChannel.channel('superfetch.transform');

function publishTransformEvent(event: TransformStageEvent): void {
  if (!transformChannel.hasSubscribers) return;
  try {
    transformChannel.publish(event);
  } catch {
    // Avoid crashing the publisher if a subscriber throws.
  }
}

export function startTransformStage(
  url: string,
  stage: string
): TransformStageContext | null {
  if (!transformChannel.hasSubscribers) return null;

  return {
    stage,
    startTime: performance.now(),
    url: redactUrl(url),
  };
}

export function endTransformStage(
  context: TransformStageContext | null,
  options?: { truncated?: boolean }
): void {
  if (!context) return;

  const requestId = (getRequestId as unknown as () => string | undefined)();
  const operationId = (getOperationId as unknown as () => string | undefined)();

  const event: TransformStageEvent = {
    v: 1,
    type: 'stage',
    stage: context.stage,
    durationMs: performance.now() - context.startTime,
    url: context.url,
    ...(requestId ? { requestId } : {}),
    ...(operationId ? { operationId } : {}),
    ...(options?.truncated !== undefined
      ? { truncated: options.truncated }
      : {}),
  };

  publishTransformEvent(event);
}
