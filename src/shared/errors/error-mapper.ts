import { ZodError } from 'zod';
import { AppError, ErrorKind, type ErrorDetail } from './app-error';

/**
 * THE single error policy for the service.
 *
 * Every transport (the Express error middleware now, Apollo's formatError later) runs
 * errors through `mapError`. That's where we decide, in one place:
 *   - which category an error belongs to,
 *   - what status/code the client sees,
 *   - whether the original message is safe to expose,
 *   - how loudly to log it.
 *
 * Rule of thumb: errors we *expected* (AppError, validation) are exposed and logged at warn.
 * Anything else is a bug or an infrastructure failure. The client gets a generic message
 * (no stack, no SQL, no hostnames) and we log the full error at error level.
 */
export interface MappedError {
  readonly kind: ErrorKind;
  readonly code: string;
  readonly httpStatus: number;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
  readonly logLevel: 'warn' | 'error';
  /** True when the error was not one we anticipated, which usually means a bug. */
  readonly unexpected: boolean;
}

const HTTP_STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = {
  [ErrorKind.Validation]: 400,
  [ErrorKind.NotFound]: 404,
  [ErrorKind.PayloadTooLarge]: 413,
  [ErrorKind.RateLimited]: 429,
  [ErrorKind.UpstreamUnavailable]: 503,
  [ErrorKind.ServiceUnavailable]: 503,
  [ErrorKind.Internal]: 500,
};

export const GENERIC_INTERNAL_MESSAGE = 'An unexpected error occurred';

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return {
      kind: error.kind,
      code: error.code,
      httpStatus: HTTP_STATUS_BY_KIND[error.kind],
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      // A dependency outage is not the caller's fault and needs attention: log it as an error.
      logLevel: error.kind === ErrorKind.UpstreamUnavailable ? 'error' : 'warn',
      unexpected: false,
    };
  }

  if (error instanceof ZodError) {
    return {
      kind: ErrorKind.Validation,
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
      message: 'Invalid input',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      logLevel: 'warn',
      unexpected: false,
    };
  }

  const bodyParserError = asBodyParserError(error);
  if (bodyParserError) {
    return bodyParserError;
  }

  return {
    kind: ErrorKind.Internal,
    code: 'INTERNAL_ERROR',
    httpStatus: 500,
    message: GENERIC_INTERNAL_MESSAGE,
    logLevel: 'error',
    unexpected: true,
  };
}

/**
 * express.json() throws http-errors shaped objects ({ type, status, expose }).
 * We translate the ones we know into our taxonomy rather than leaking their wording.
 */
function asBodyParserError(error: unknown): MappedError | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return undefined;
  }
  const { type } = error;
  if (type === 'entity.parse.failed') {
    return {
      kind: ErrorKind.Validation,
      code: 'MALFORMED_JSON',
      httpStatus: 400,
      message: 'Request body is not valid JSON',
      logLevel: 'warn',
      unexpected: false,
    };
  }
  if (type === 'entity.too.large') {
    return {
      kind: ErrorKind.PayloadTooLarge,
      code: 'PAYLOAD_TOO_LARGE',
      httpStatus: 413,
      message: 'Request body is too large',
      logLevel: 'warn',
      unexpected: false,
    };
  }
  return undefined;
}
