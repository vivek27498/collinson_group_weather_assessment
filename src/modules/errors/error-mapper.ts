import { ZodError } from 'zod';
import { AppError, ErrorKind, type ErrorDetail } from './app-error';

/**
 * The ONE place that decides how every error is handled.
 *
 * Both the Express error handler (REST) and format-error.ts (GraphQL) call `mapError`, which
 * decides:
 *   - what kind of error it is,
 *   - which status code and error code the client gets,
 *   - whether the message is safe to show the client,
 *   - whether to log it as a warning or an error.
 *
 * Rule of thumb: errors we EXPECTED (an AppError, bad input) are shown to the client and logged
 * as warnings. Anything else is a bug or an outage: the client gets a generic message (no stack
 * trace, no SQL, no hostnames) and we log the full error.
 */
export interface MappedError {
  kind: ErrorKind;
  code: string;
  httpStatus: number;
  message: string;
  details?: ErrorDetail[];
  logLevel: 'warn' | 'error';
  /** True when the error was not one we anticipated, which usually means a bug. */
  unexpected: boolean;
}

const HTTP_STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = {
  [ErrorKind.Validation]: 400,
  [ErrorKind.NotFound]: 404,
  [ErrorKind.PayloadTooLarge]: 413,
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
      details: error.details,
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
 * express.json() throws its own error objects (with a `type` field) for a bad request body.
 * We turn the two we know about into our own errors, with our own wording.
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
