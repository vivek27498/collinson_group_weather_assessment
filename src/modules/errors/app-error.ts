/**
 * Our error classes.
 *
 * `kind` says WHAT went wrong (validation, not found, ...). It deliberately says nothing about
 * HTTP: only error-mapper.ts turns a kind into a status code (400, 404, 503...). That way the
 * services never need to know about HTTP.
 *
 * `code` is a fixed identifier clients can check in code (e.g. LOCATION_NOT_FOUND).
 * We may reword a message, but we never change a code.
 */
// Works like an enum: use `ErrorKind.NotFound` in code.
export const ErrorKind = {
  Validation: 'VALIDATION',
  NotFound: 'NOT_FOUND',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  UpstreamUnavailable: 'UPSTREAM_UNAVAILABLE',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  Internal: 'INTERNAL',
} as const;
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

/** One problem with the input, e.g. { path: 'city', message: 'City is required' }. */
export interface ErrorDetail {
  path?: string;
  message: string;
}

export interface AppErrorOptions {
  code?: string;
  details?: ErrorDetail[];
  cause?: unknown;
}

/** The base class for every error we throw on purpose. */
export abstract class AppError extends Error {
  abstract kind: ErrorKind;
  code: string;
  details: ErrorDetail[] | undefined;

  protected constructor(message: string, defaultCode: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name; // e.g. "NotFoundError", so logs show the real class name
    this.code = options.code ?? defaultCode;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  kind = ErrorKind.Validation;
  constructor(message = 'Invalid input', options?: AppErrorOptions) {
    super(message, 'VALIDATION_ERROR', options);
  }
}

export class NotFoundError extends AppError {
  kind = ErrorKind.NotFound;
  constructor(message = 'Resource not found', options?: AppErrorOptions) {
    super(message, 'NOT_FOUND', options);
  }
}

/** A dependency we call (Open-Meteo, the database) failed or timed out. */
export class UpstreamUnavailableError extends AppError {
  kind = ErrorKind.UpstreamUnavailable;
  constructor(message = 'A dependency is temporarily unavailable', options?: AppErrorOptions) {
    super(message, 'UPSTREAM_UNAVAILABLE', options);
  }
}

/** This instance can't serve right now (e.g. draining during shutdown). Expected, so logged at warn. */
export class ServiceUnavailableError extends AppError {
  kind = ErrorKind.ServiceUnavailable;
  constructor(message = 'Service temporarily unavailable', options?: AppErrorOptions) {
    super(message, 'SERVICE_UNAVAILABLE', options);
  }
}
