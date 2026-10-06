import { Activity, type DayConditions } from '../types';
import { categoriseWeatherCode, WeatherCategory } from '../weather-codes';
import type { ActivityScorer } from './activity-scorer';
import { adjustIf, combine, fmt, rampPenalty, type ScoreResult } from './score';
import type { ScoringConfig } from './scoring-config';

/**
 * Outdoor sightseeing: comfortable temperature, dry, not too windy, ideally sunny.
 * Rain is judged on both amount (how wet you'll get) and probability (how likely plans are
 * disrupted). They're separate signals with separate, smaller caps to avoid double-counting.
 */
export class OutdoorSightseeingScorer implements ActivityScorer {
  readonly activity = Activity.OutdoorSightseeing;

  constructor(private readonly rules: ScoringConfig['outdoor']) {}

  score({ weather }: DayConditions): ScoreResult {
    const r = this.rules;
    const category = categoriseWeatherCode(weather.weatherCode);
    const sunshineHours =
      weather.sunshineDurationS === null ? null : weather.sunshineDurationS / 3600;
    const rainChance = weather.precipitationProbabilityMaxPct;

    return combine(100, [
      rampPenalty(
        weather.temperatureMaxC,
        r.coldTempC,
        `Cold (max ${fmt(weather.temperatureMaxC)}°C)`,
      ),
      rampPenalty(
        weather.temperatureMaxC,
        r.hotTempC,
        `Hot (max ${fmt(weather.temperatureMaxC)}°C)`,
      ),
      rampPenalty(
        weather.precipitationSumMm,
        r.precipitationMm,
        `Rain ${fmt(weather.precipitationSumMm)} mm`,
      ),
      rainChance === null
        ? null
        : rampPenalty(
            rainChance,
            r.precipitationProbabilityPct,
            `${fmt(rainChance)}% chance of rain`,
          ),
      rampPenalty(
        weather.windSpeedMaxKmh,
        r.windKmh,
        `Windy (${fmt(weather.windSpeedMaxKmh)} km/h)`,
      ),
      adjustIf(category === WeatherCategory.Thunderstorm, r.thunderstorm.points, 'Thunderstorms'),
      adjustIf(category === WeatherCategory.Fog, r.fog.points, 'Fog limits views'),
      adjustIf(category === WeatherCategory.Snow, r.snow.points, 'Snowfall'),
      adjustIf(
        sunshineHours !== null && sunshineHours >= r.sunshine.minHours,
        r.sunshine.points,
        `Sunny (${fmt(Math.round(sunshineHours ?? 0))} h sunshine)`,
      ),
      adjustIf(
        weather.uvIndexMax !== null && weather.uvIndexMax >= r.highUv.atLeast,
        r.highUv.points,
        `Very high UV (${fmt(weather.uvIndexMax ?? 0)})`,
      ),
    ]);
  }
}
