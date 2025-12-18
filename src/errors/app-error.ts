export class FetchError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    public url: string,
    httpStatus?: number,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'FetchError';
    this.statusCode = httpStatus ?? 502;
    this.code = httpStatus ? `HTTP_${httpStatus}` : 'FETCH_ERROR';
    this.details = { url, httpStatus, ...details };
    Error.captureStackTrace(this, this.constructor);
  }
}
