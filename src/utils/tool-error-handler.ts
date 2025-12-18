import type { ToolErrorResponse } from '../config/types.js';

import { FetchError } from '../errors/app-error.js';

/** Environment flag for development mode with stack trace exposure */
const IS_DEVELOPMENT_WITH_STACK_TRACES =
  process.env.NODE_ENV === 'development' &&
  process.env.EXPOSE_STACK_TRACES === 'true';

/**
 * Creates a standardized tool error response.
 *
 * @param message - Human-readable error message
 * @param url - The URL that caused the error
 * @param code - Machine-readable error code
 */
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

/**
 * Formats error message with optional stack trace for development.
 */
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

/**
 * Handles tool errors and returns standardized error response.
 * Extracts error details from FetchError or generic Error instances.
 *
 * @param error - The caught error
 * @param url - The URL that caused the error
 * @param fallbackMessage - Default message if error details unavailable
 */
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
