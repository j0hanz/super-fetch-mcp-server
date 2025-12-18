const DEFAULT_HTTP_STATUS = 502;

export class FetchError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    readonly url: string,
    httpStatus?: number,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'FetchError';
    this.statusCode = httpStatus ?? DEFAULT_HTTP_STATUS;
    this.code = httpStatus ? `HTTP_${httpStatus}` : 'FETCH_ERROR';
    this.details = Object.freeze({ url, httpStatus, ...details });
    Error.captureStackTrace(this, this.constructor);
  }
}
