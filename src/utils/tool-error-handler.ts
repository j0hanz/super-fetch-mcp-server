import type { ToolErrorResponse } from '../config/types.js';

import { FetchError } from '../errors/app-error.js';

// Stack traces only exposed when explicitly enabled in development
const isDevelopment =
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

export function handleToolError(
  error: unknown,
  url: string,
  fallbackMessage = 'Operation failed'
): ToolErrorResponse {
  if (error instanceof FetchError) {
    const message = isDevelopment
      ? `${error.message}\n${error.stack ?? ''}`
      : error.message;
    return createToolErrorResponse(message, url, error.code);
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  const fullMessage =
    isDevelopment && error instanceof Error
      ? `${fallbackMessage}: ${message}\n${error.stack ?? ''}`
      : `${fallbackMessage}: ${message}`;

  return createToolErrorResponse(fullMessage, url, 'UNKNOWN_ERROR');
}
