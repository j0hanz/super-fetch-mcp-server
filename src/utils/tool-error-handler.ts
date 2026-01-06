import type { ToolErrorResponse } from '../config/types/tools.js';

import { FetchError } from '../errors/app-error.js';

import { isSystemError } from './error-utils.js';

export function createToolErrorResponse(
  message: string,
  url: string
): ToolErrorResponse {
  const structuredContent = {
    error: message,
    url,
  };

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
  if (isValidationError(error)) {
    return createToolErrorResponse(error.message, url);
  }

  if (error instanceof FetchError) {
    return createToolErrorResponse(error.message, url);
  }

  if (error instanceof Error) {
    const message = `${fallbackMessage}: ${error.message}`;
    return createToolErrorResponse(message, url);
  }

  return createToolErrorResponse(`${fallbackMessage}: Unknown error`, url);
}

function isValidationError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    isSystemError(error) &&
    error.code === 'VALIDATION_ERROR'
  );
}
