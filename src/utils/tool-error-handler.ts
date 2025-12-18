import type { ToolErrorResponse } from '../config/types.js';

import { FetchError } from '../errors/app-error.js';

const IS_DEVELOPMENT_WITH_STACK_TRACES =
  process.env.NODE_ENV === 'development' &&
  process.env.EXPOSE_STACK_TRACES === 'true';

export function createToolErrorResponse(
  message: string,
  url: string,
  code: string
): ToolErrorResponse {
  const structuredContent = { error: message, url, errorCode: code };

  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

function formatErrorMessage(
  baseMessage: string,
  error: Error,
  fallback?: string
): string {
  const message = fallback ? `${fallback}: ${error.message}` : error.message;

  if (IS_DEVELOPMENT_WITH_STACK_TRACES && error.stack) {
    return `${message}\n${error.stack}`;
  }

  return message;
}

export function handleToolError(
  error: unknown,
  url: string,
  fallbackMessage = 'Operation failed'
): ToolErrorResponse {
  if (error instanceof FetchError) {
    const message = formatErrorMessage(error.message, error);
    return createToolErrorResponse(message, url, error.code);
  }

  if (error instanceof Error) {
    const message = formatErrorMessage(error.message, error, fallbackMessage);
    return createToolErrorResponse(message, url, 'UNKNOWN_ERROR');
  }

  return createToolErrorResponse(
    `${fallbackMessage}: Unknown error`,
    url,
    'UNKNOWN_ERROR'
  );
}
