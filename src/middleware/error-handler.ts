import type { NextFunction, Request, Response } from 'express';

import type { ErrorResponse } from '../config/types.js';

import { AppError } from '../errors/app-error.js';

import { logError } from '../services/logger.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'Internal Server Error';

  logError(
    `HTTP ${statusCode}: ${err.message} - ${req.method} ${req.path}`,
    err
  );

  // Handle Retry-After for rate limiting
  if (isAppError && err.code === 'RATE_LIMITED' && err.details.retryAfter) {
    const retryAfter = err.details.retryAfter as number;
    res.set('Retry-After', String(retryAfter));
  }

  const response: ErrorResponse = {
    error: {
      message,
      code,
      statusCode,
      ...(isAppError &&
        Object.keys(err.details).length > 0 && { details: err.details }),
    },
  };

  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);

  // Ensure middleware chain ends here
  next();
}
