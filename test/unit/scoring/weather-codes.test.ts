import { categoriseWeatherCode, isWet, WeatherCategory } from '../../../src/scoring/weather-codes';

describe('categoriseWeatherCode', () => {
  it.each([
    [[0], WeatherCategory.Clear],
    [[1, 2, 3], WeatherCategory.Cloudy],
    [[45, 48], WeatherCategory.Fog],
    [[51, 53, 55, 56, 57], WeatherCategory.Drizzle],
    [[61, 63, 65, 66, 67, 80, 81, 82], WeatherCategory.Rain],
    [[71, 73, 75, 77, 85, 86], WeatherCategory.Snow],
    [[95, 96, 99], WeatherCategory.Thunderstorm],
    [[-1, 4, 50, 60, 100], WeatherCategory.Unknown],
  ])('maps WMO codes %p to %s', (codes, category) => {
    for (const code of codes) {
      expect(categoriseWeatherCode(code)).toBe(category);
    }
  });
});

describe('isWet', () => {
  it.each([
    [WeatherCategory.Drizzle, true],
    [WeatherCategory.Rain, true],
    [WeatherCategory.Snow, false],
    [WeatherCategory.Thunderstorm, false],
    [WeatherCategory.Clear, false],
  ])('%s → %p', (category, expected) => {
    expect(isWet(category)).toBe(expected);
  });
});
