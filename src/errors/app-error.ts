/** Default HTTP status code for fetch errors (Bad Gateway) */
const DEFAULT_HTTP_STATUS = 502;

/**
 * Custom error class for HTTP fetch operations.
 * Includes URL context, HTTP status, and structured error details.
 */
export class FetchError extends Error {
  /** HTTP status code of the error response */
  readonly statusCode: number;

  /** Machine-readable error code (e.g., 'HTTP_404', 'FETCH_ERROR') */
  readonly code: string;

  /** Structured error details for debugging */
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
