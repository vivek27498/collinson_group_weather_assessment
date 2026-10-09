import { Activity, type DayConditions } from '../types';
import { categoriseWeatherCode, WeatherCategory } from './weather-codes';
import type { ActivityScorer } from './activity-scorer';
import { adjustIf, calculateScore, formatNumber, rampPenalty, type ScoreResult } from './score';
import type { ScoringConfig } from '../config/scoring';

/**
 * Outdoor sightseeing: comfortable temperature, dry, not too windy, ideally sunny.
 * Rain is judged on both amount (how wet you'll get) and probability (how likely plans are
 * disrupted). They're separate signals with separate, smaller caps to avoid double-counting.
 */
export class OutdoorSightseeingScorer implements ActivityScorer {
  activity = Activity.OutdoorSightseeing;

  constructor(private rules: ScoringConfig['outdoor']) {}

  score({ weather }: DayConditions): ScoreResult {
    const rules = this.rules;
    const category = categoriseWeatherCode(weather.weatherCode);
    const sunshineHours =
      weather.sunshineDurationS === null ? null : weather.sunshineDurationS / 3600;
    const rainChance = weather.precipitationProbabilityMaxPct;

    return calculateScore(100, [
      rampPenalty(
        weather.temperatureMaxC,
        rules.coldTempC,
        `Cold (max ${formatNumber(weather.temperatureMaxC)}°C)`,
      ),
      rampPenalty(
        weather.temperatureMaxC,
        rules.hotTempC,
        `Hot (max ${formatNumber(weather.temperatureMaxC)}°C)`,
      ),
      rampPenalty(
        weather.precipitationSumMm,
        rules.precipitationMm,
        `Rain ${formatNumber(weather.precipitationSumMm)} mm`,
      ),
      rainChance === null
        ? null
        : rampPenalty(
            rainChance,
            rules.precipitationProbabilityPct,
            `${formatNumber(rainChance)}% chance of rain`,
          ),
      rampPenalty(
        weather.windSpeedMaxKmh,
        rules.windKmh,
        `Windy (${formatNumber(weather.windSpeedMaxKmh)} km/h)`,
      ),
      adjustIf(
        category === WeatherCategory.Thunderstorm,
        rules.thunderstorm.points,
        'Thunderstorms',
      ),
      adjustIf(category === WeatherCategory.Fog, rules.fog.points, 'Fog limits views'),
      adjustIf(category === WeatherCategory.Snow, rules.snow.points, 'Snowfall'),
      adjustIf(
        sunshineHours !== null && sunshineHours >= rules.sunshine.minHours,
        rules.sunshine.points,
        `Sunny (${formatNumber(Math.round(sunshineHours ?? 0))} h sunshine)`,
      ),
      adjustIf(
        weather.uvIndexMax !== null && weather.uvIndexMax >= rules.highUv.atLeast,
        rules.highUv.points,
        `Very high UV (${formatNumber(weather.uvIndexMax ?? 0)})`,
      ),
    ]);
  }
}
