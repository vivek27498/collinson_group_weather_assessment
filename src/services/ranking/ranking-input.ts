import { z } from 'zod';
import type { ErrorDetail } from '../../modules/errors';
import type { LocationQuery } from '../interfaces';

/**
 * Decides what counts as a valid search. It lives here (not in the GraphQL code) so that any
 * other entry point, such as a future REST endpoint, uses exactly the same rules.
 *
 * We describe what a place name LOOKS LIKE and reject everything else (an "allow-list"):
 * letters in any alphabet, accents, spaces, apostrophes, hyphens and dots, so "L'Aquila",
 * "Saint-Étienne", "St. Moritz" and "東京" pass. SQL, HTML and control characters never reach
 * Open-Meteo, the database or the logs.
 *
 * Trade-off: digits are rejected. A few real places contain them, but a strict rule is safer
 * (see questions-and-assumptions.md).
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
  { ok: true; query: LocationQuery } | { ok: false; errors: ErrorDetail[] };

export function parseRankingInput(input: {
  city: string;
  countryCode?: string | null;
}): ParsedRankingInput {
  const result = rankingInputSchema.safeParse(input);
  if (!result.success) {
    // One message per field (the first failing rule): "City is required" is more useful
    // than also being told the empty string contains no letters.
    const errors: ErrorDetail[] = [];
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      const alreadyHasError = errors.some((e) => e.path === path);
      if (!alreadyHasError) {
        errors.push({ path, message: issue.message });
      }
    }
    return { ok: false, errors };
  }
  const { city, countryCode } = result.data;
  const query: LocationQuery = { name: city };
  if (countryCode) {
    query.countryCode = countryCode;
  }
  return { ok: true, query };
}
