export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class FetchError extends AppError {
  constructor(
    message: string,
    url: string,
    httpStatus?: number,
    details?: Record<string, unknown>
  ) {
    super(
      message,
      httpStatus ?? 502,
      httpStatus ? `HTTP_${httpStatus}` : 'FETCH_ERROR',
      { url, httpStatus, ...details }
    );
  }
}
