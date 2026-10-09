import { z } from 'zod';
import { HttpRequestError } from '../../modules/http';

/**
 * Checks that a response from Open-Meteo has the shape we expect, using a Zod schema.
 *
 * If Open-Meteo ever changes its format we fail loudly here with an "invalid response" error
 * (not worth retrying), instead of letting `undefined` values sneak into the scoring and
 * produce wrong rankings without anyone noticing.
 */
export function parseResponse<T>(schema: z.ZodType<T>, payload: unknown, serviceName: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new HttpRequestError(serviceName, 'invalid_response', undefined, false, result.error);
  }
  return result.data;
}

/** Open-Meteo returns one array per variable (one entry per day or hour); any entry may be null. */
export const nullableNumberArray = z.array(z.number().nullable());
