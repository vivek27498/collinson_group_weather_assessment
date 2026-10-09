import { z } from 'zod';
import { UpstreamRequestError } from '../../modules/http';

/**
 * Never trust a third-party payload's shape. If Open-Meteo changes its contract we want a
 * clear, non-retryable "invalid response" at the boundary, not `undefined` leaking into
 * scoring and producing silently wrong rankings.
 */
export function parseResponse<T>(schema: z.ZodType<T>, payload: unknown, upstream: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new UpstreamRequestError(upstream, 'invalid_response', undefined, false, result.error);
  }
  return result.data;
}

/** Open-Meteo returns parallel arrays (one entry per day/hour) where any element may be null. */
export const nullableNumberArray = z.array(z.number().nullable());
