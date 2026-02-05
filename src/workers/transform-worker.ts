import { parentPort } from 'node:worker_threads';

import { z } from 'zod';

import { FetchError, getErrorMessage } from '../errors.js';
import type {
  MarkdownTransformResult,
  TransformWorkerCancelMessage,
  TransformWorkerErrorMessage,
  TransformWorkerOutgoingMessage,
  TransformWorkerTransformMessage,
} from '../transform-types.js';
import { transformHtmlToMarkdownInProcess } from '../transform.js';

const port =
  parentPort ??
  (() => {
    throw new Error('transform-worker started without parentPort');
  })();

const controllersById = new Map<string, AbortController>();

function post(message: TransformWorkerOutgoingMessage): void {
  port.postMessage(message);
}

function postError(
  id: string,
  error: TransformWorkerErrorMessage['error']
): void {
  post({ type: 'error', id, error });
}

function validateTransformMessage(
  message: TransformWorkerTransformMessage
): string | null {
  if (!message.id.trim()) return 'Missing transform message id';
  if (!message.url.trim()) return 'Missing transform URL';
  return null;
}

function toValidationWorkerError(
  message: TransformWorkerTransformMessage,
  reason: string
): TransformWorkerErrorMessage['error'] {
  return {
    name: 'ValidationError',
    message: reason,
    url: message.url,
  };
}

function toFetchWorkerError(
  error: FetchError
): TransformWorkerErrorMessage['error'] {
  return {
    name: error.name,
    message: error.message,
    url: error.url,
    statusCode: error.statusCode,
    details: { ...error.details },
  };
}

function toUnknownWorkerError(
  message: TransformWorkerTransformMessage,
  error: unknown
): TransformWorkerErrorMessage['error'] {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: getErrorMessage(error),
    url: message.url,
  };
}

function toOutgoingResult(result: MarkdownTransformResult): {
  markdown: string;
  title?: string;
  truncated: boolean;
} {
  const { markdown, title, truncated } = result;
  return title === undefined
    ? { markdown, truncated }
    : { markdown, title, truncated };
}

function handleTransform(message: TransformWorkerTransformMessage): void {
  const validationError = validateTransformMessage(message);
  if (validationError) {
    postError(message.id, toValidationWorkerError(message, validationError));
    return;
  }

  const controller = new AbortController();
  controllersById.set(message.id, controller);

  try {
    const result = transformHtmlToMarkdownInProcess(message.html, message.url, {
      includeMetadata: message.includeMetadata,
      signal: controller.signal,
      ...(message.skipNoiseRemoval ? { skipNoiseRemoval: true } : {}),
    });

    post({
      type: 'result',
      id: message.id,
      result: toOutgoingResult(result),
    });
  } catch (error: unknown) {
    if (error instanceof FetchError) {
      postError(message.id, toFetchWorkerError(error));
      return;
    }

    postError(message.id, toUnknownWorkerError(message, error));
  } finally {
    controllersById.delete(message.id);
  }
}

function handleCancel(message: TransformWorkerCancelMessage): void {
  const controller = controllersById.get(message.id);
  if (!controller) return;

  // Note: cancellation only interrupts work if the transform function yields and respects AbortSignal.
  controller.abort(new Error('Canceled'));
}

const TransformMessageSchema = z.object({
  type: z.literal('transform'),
  id: z.string(),
  html: z.string(),
  url: z.string(),
  includeMetadata: z.boolean(),
  skipNoiseRemoval: z.boolean().optional(),
});

const CancelMessageSchema = z.object({
  type: z.literal('cancel'),
  id: z.string(),
});

const IncomingMessageSchema = z.discriminatedUnion('type', [
  TransformMessageSchema,
  CancelMessageSchema,
]);

port.on('message', (raw: unknown) => {
  const parsed = IncomingMessageSchema.safeParse(raw);
  if (!parsed.success) return;

  const message = parsed.data;

  if (message.type === 'cancel') {
    handleCancel(message);
    return;
  }

  handleTransform(message);
});
