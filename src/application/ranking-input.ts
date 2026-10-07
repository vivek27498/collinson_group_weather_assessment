import { z } from 'zod';
import type { ErrorDetail } from '../shared/errors/app-error';
import type { LocationQuery } from './ports';

/**
 * What counts as a valid place query. This is a business rule, so it lives in the application
 * layer, not in GraphQL: any future transport (REST, a queue consumer) gets the same rules.
 *
 * Allow-list, not block-list: we accept what place names look like (letters in any script,
 * combining marks, spaces, apostrophes, hyphens, dots: "L'Aquila", "Saint-Étienne",
 * "St. Moritz", "東京") and reject everything else. SQL/HTML/control characters never reach
 * the geocoder, the cache key or the logs.
 *
 * Trade-off: digits are rejected. A handful of real places contain them; the risk was judged
 * smaller than the benefit of a tight allow-list (see questions-and-assumptions.md).
 */
export const CITY_MAX_LENGTH = 100;
const PLACE_NAME = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;
const COUNTRY_CODE = /^[A-Za-z]{2}$/;

/** NFC + trim + collapse internal whitespace, so "  Saint   Malo " and "Saint Malo" are one cache key. */
export function normalisePlaceName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

const rankingInputSchema = z.object({
  city: z
    .string()
    .transform(normalisePlaceName)
    .pipe(
      z
        .string()
        .min(1, 'City is required')
        .max(CITY_MAX_LENGTH, `City must be at most ${CITY_MAX_LENGTH} characters`)
        .regex(PLACE_NAME, 'City may only contain letters, spaces, apostrophes, hyphens and dots'),
    ),
  countryCode: z
    .string()
    .trim()
    .regex(COUNTRY_CODE, 'Country code must be a 2-letter ISO 3166-1 code, e.g. "FR"')
    .transform((code) => code.toUpperCase())
    .nullish(),
});

export type ParsedRankingInput =
  | { readonly ok: true; readonly query: LocationQuery }
  | { readonly ok: false; readonly errors: readonly ErrorDetail[] };

export function parseRankingInput(input: {
  city: string;
  countryCode?: string | null;
}): ParsedRankingInput {
  const result = rankingInputSchema.safeParse(input);
  if (!result.success) {
    // One message per field (the first failing rule): "City is required" is more useful
    // than also being told the empty string contains no letters.
    const byField = new Map<string, string>();
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (!byField.has(path)) byField.set(path, issue.message);
    }
    return {
      ok: false,
      errors: [...byField].map(([path, message]) => ({ path, message })),
    };
  }
  const { city, countryCode } = result.data;
  return { ok: true, query: { name: city, ...(countryCode ? { countryCode } : {}) } };
}
