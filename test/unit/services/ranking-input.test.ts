import {
  CITY_MAX_LENGTH,
  normalisePlaceName,
  parseRankingInput,
} from '../../../src/services/ranking-input';

describe('parseRankingInput', () => {
  describe('accepts real place names in any script', () => {
    it.each([
      ['Chamonix'],
      ["L'Aquila"],
      ['Saint-Étienne'],
      ['St. Moritz'],
      ['São Paulo'],
      ['Zürich'],
      ['東京'],
      ['Москва'],
      ['Ōsaka'],
      ['Llanfairpwllgwyngyll'],
      ['A'],
      ['x'.repeat(CITY_MAX_LENGTH)],
    ])('%s', (city) => {
      expect(parseRankingInput({ city })).toEqual({ ok: true, query: { name: city } });
    });
  });

  it('normalises whitespace so equivalent queries share one cache key', () => {
    expect(parseRankingInput({ city: '  New \t  York  ' })).toEqual({
      ok: true,
      query: { name: 'New York' },
    });
  });

  it('normalises Unicode to NFC ("é" typed as e + combining accent)', () => {
    const decomposed = 'Saint-Étienne';
    const result = parseRankingInput({ city: decomposed });

    expect(result).toEqual({ ok: true, query: { name: 'Saint-Étienne' } });
  });

  it('upper-cases and trims a country code, and omits it when empty/null', () => {
    expect(parseRankingInput({ city: 'Paris', countryCode: ' us ' })).toEqual({
      ok: true,
      query: { name: 'Paris', countryCode: 'US' },
    });
    expect(parseRankingInput({ city: 'Paris', countryCode: null })).toEqual({
      ok: true,
      query: { name: 'Paris' },
    });
  });

  describe('rejects input that is not a place name, before anything is looked up', () => {
    it.each([
      ['empty', ''],
      ['only spaces', '    '],
      ['too long', 'x'.repeat(CITY_MAX_LENGTH + 1)],
      ['digits', 'Paris 75001'],
      ['SQL injection: statement break', "'; DROP TABLE locations;--"],
      ['SQL injection: tautology', "Paris' OR '1'='1"],
      ['SQL injection: comment', 'Paris/*x*/'],
      ['URL-encoded payload', '%27%20OR%201=1'],
      ['HTML / XSS', '<script>alert(1)</script>'],
      ['log injection (newline)', 'Paris\n{"level":"fatal"}'],
      ['control character', 'Par\u0000is'],
      ['emoji', 'Paris 🗼'],
      ['starts with punctuation', '-Paris'],
      ['path traversal', '../../etc/passwd'],
    ])('%s', (_case, city) => {
      const result = parseRankingInput({ city });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.path).toBe('city');
    });
  });

  it.each([['FRA'], ['F'], ['1A'], ['F-'], ["F'"]])('rejects country code %p', (countryCode) => {
    const result = parseRankingInput({ city: 'Paris', countryCode });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors).toEqual([
        { path: 'countryCode', message: expect.any(String) as unknown },
      ]);
  });

  it('reports every invalid field at once', () => {
    const result = parseRankingInput({ city: '', countryCode: 'XYZ' });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.map((e) => e.path).sort()).toEqual(['city', 'countryCode']);
  });
});

describe('normalisePlaceName', () => {
  it('trims, collapses whitespace and applies NFC', () => {
    expect(normalisePlaceName('  Saint   Malo ')).toBe('Saint Malo');
  });
});
