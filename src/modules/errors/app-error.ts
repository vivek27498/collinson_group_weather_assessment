/**
 * Error taxonomy.
 *
 * `kind` is a transport-agnostic category. Domain and application code throw errors that
 * say *what* went wrong, and only the error mapper decides what that means for HTTP
 * (status codes) or GraphQL (extensions.code). This keeps HTTP out of the domain.
 *
 * `code` is a stable, machine-readable identifier clients can switch on
 * (e.g. LOCATION_NOT_FOUND). Messages may change; codes may not.
 */
export const ErrorKind = {
  Validation: 'VALIDATION',
  NotFound: 'NOT_FOUND',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  UpstreamUnavailable: 'UPSTREAM_UNAVAILABLE',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  Internal: 'INTERNAL',
} as const;
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

export interface ErrorDetail {
  readonly path?: string;
  readonly message: string;
}

export interface AppErrorOptions {
  readonly code?: string;
  readonly details?: readonly ErrorDetail[];
  readonly cause?: unknown;
}

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  readonly code: string;
  readonly details: readonly ErrorDetail[] | undefined;

  protected constructor(message: string, defaultCode: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? defaultCode;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  readonly kind = ErrorKind.Validation;
  constructor(message = 'Invalid input', options?: AppErrorOptions) {
    super(message, 'VALIDATION_ERROR', options);
  }
}

export class NotFoundError extends AppError {
  readonly kind = ErrorKind.NotFound;
  constructor(message = 'Resource not found', options?: AppErrorOptions) {
    super(message, 'NOT_FOUND', options);
  }
}

/** A dependency we call (Open-Meteo, the database) failed or timed out. */
export class UpstreamUnavailableError extends AppError {
  readonly kind = ErrorKind.UpstreamUnavailable;
  constructor(message = 'A dependency is temporarily unavailable', options?: AppErrorOptions) {
    super(message, 'UPSTREAM_UNAVAILABLE', options);
  }
}

/** This instance can't serve right now (e.g. draining during shutdown). Expected, so logged at warn. */
export class ServiceUnavailableError extends AppError {
  readonly kind = ErrorKind.ServiceUnavailable;
  constructor(message = 'Service temporarily unavailable', options?: AppErrorOptions) {
    super(message, 'SERVICE_UNAVAILABLE', options);
  }
}
