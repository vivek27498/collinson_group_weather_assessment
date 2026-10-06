/**
 * WMO weather interpretation codes (as used by Open-Meteo) grouped into the few
 * categories our scoring rules care about. Scorers depend on categories, never raw codes.
 * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes).
 */
export const WeatherCategory = {
  Clear: 'CLEAR',
  Cloudy: 'CLOUDY',
  Fog: 'FOG',
  Drizzle: 'DRIZZLE',
  Rain: 'RAIN',
  Snow: 'SNOW',
  Thunderstorm: 'THUNDERSTORM',
  Unknown: 'UNKNOWN',
} as const;
export type WeatherCategory = (typeof WeatherCategory)[keyof typeof WeatherCategory];

export function categoriseWeatherCode(code: number): WeatherCategory {
  if (code === 0) return WeatherCategory.Clear;
  if (code >= 1 && code <= 3) return WeatherCategory.Cloudy;
  if (code === 45 || code === 48) return WeatherCategory.Fog;
  if (code >= 51 && code <= 57) return WeatherCategory.Drizzle;
  // 61–67 rain incl. freezing rain; 80–82 rain showers.
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return WeatherCategory.Rain;
  // 71–77 snowfall and snow grains; 85–86 snow showers.
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return WeatherCategory.Snow;
  if (code >= 95 && code <= 99) return WeatherCategory.Thunderstorm;
  return WeatherCategory.Unknown;
}

export function isWet(category: WeatherCategory): boolean {
  return category === WeatherCategory.Drizzle || category === WeatherCategory.Rain;
}
