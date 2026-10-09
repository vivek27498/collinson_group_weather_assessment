import { z } from 'zod';
import {
  ErrorKind,
  NotFoundError,
  ServiceUnavailableError,
  UpstreamUnavailableError,
  ValidationError,
} from '../../../src/shared/errors/app-error';
import { GENERIC_INTERNAL_MESSAGE, mapError } from '../../../src/shared/errors/error-mapper';

describe('mapError', () => {
  describe('AppError subclasses (expected errors)', () => {
    it.each([
      [new ValidationError('bad city'), ErrorKind.Validation, 'VALIDATION_ERROR', 400, 'warn'],
      [new NotFoundError('no such city'), ErrorKind.NotFound, 'NOT_FOUND', 404, 'warn'],
      [
        new ServiceUnavailableError(),
        ErrorKind.ServiceUnavailable,
        'SERVICE_UNAVAILABLE',
        503,
        'warn',
      ],
      [
        new UpstreamUnavailableError(),
        ErrorKind.UpstreamUnavailable,
        'UPSTREAM_UNAVAILABLE',
        503,
        'error',
      ],
    ])('maps %p to kind=%s code=%s status=%i log=%s', (error, kind, code, status, logLevel) => {
      const mapped = mapError(error);

      expect(mapped).toMatchObject({
        kind,
        code,
        httpStatus: status,
        message: error.message,
        logLevel,
        unexpected: false,
      });
    });

    it('keeps a custom, more specific code', () => {
      const mapped = mapError(new NotFoundError('Paris?', { code: 'LOCATION_NOT_FOUND' }));

      expect(mapped.code).toBe('LOCATION_NOT_FOUND');
      expect(mapped.httpStatus).toBe(404);
    });

    it('passes structured details through', () => {
      const details = [{ path: 'city', message: 'too long' }];
      const mapped = mapError(new ValidationError('Invalid input', { details }));

      expect(mapped.details).toEqual(details);
    });

    it('preserves the original cause for logging', () => {
      const cause = new Error('ECONNRESET');
      const error = new UpstreamUnavailableError('Open-Meteo down', { cause });

      expect(error.cause).toBe(cause);
      expect(error.name).toBe('UpstreamUnavailableError');
    });
  });

  it('maps a ZodError to a validation error with per-field details', () => {
    const schema = z.object({ city: z.string().min(1), countryCode: z.string().length(2) });
    const result = schema.safeParse({ city: '', countryCode: 'GBR' });
    if (result.success) throw new Error('expected validation to fail');

    const mapped = mapError(result.error);

    expect(mapped).toMatchObject({ kind: ErrorKind.Validation, httpStatus: 400, logLevel: 'warn' });
    expect(mapped.details?.map((d) => d.path)).toEqual(['city', 'countryCode']);
  });

  it.each([
    ['entity.parse.failed', 'MALFORMED_JSON', 400],
    ['entity.too.large', 'PAYLOAD_TOO_LARGE', 413],
  ])('maps body-parser error type %s to %s (%i)', (type, code, status) => {
    const mapped = mapError(Object.assign(new Error('raw parser message'), { type }));

    expect(mapped.code).toBe(code);
    expect(mapped.httpStatus).toBe(status);
    expect(mapped.message).not.toContain('raw parser message');
  });

  describe('unexpected errors', () => {
    it.each([
      ['a plain Error', new Error('SELECT * FROM users WHERE password=...')],
      ['a TypeError', new TypeError("Cannot read properties of undefined (reading 'x')")],
      ['a thrown string', 'boom'],
      ['null', null],
      [
        'an unknown body-parser type',
        Object.assign(new Error('x'), { type: 'charset.unsupported' }),
      ],
    ])('hides the details of %s behind a generic 500', (_case, error) => {
      const mapped = mapError(error);

      expect(mapped).toEqual({
        kind: ErrorKind.Internal,
        code: 'INTERNAL_ERROR',
        httpStatus: 500,
        message: GENERIC_INTERNAL_MESSAGE,
        logLevel: 'error',
        unexpected: true,
      });
    });
  });
});
