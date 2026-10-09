import { Activity, type DayConditions, type LocationContext } from '../types';
import { categoriseWeatherCode, isWet, WeatherCategory } from './weather-codes';
import type { ActivityScorer } from './activity-scorer';
import {
  adjustIf,
  calculateScore,
  formatNumber,
  rampPenalty,
  type Adjustment,
  type ScoreResult,
} from './score';
import type { ScoringConfig } from '../config/scoring';

/**
 * Skiing cares most about snow on the ground, then about conditions that close lifts
 * (gusts, storms) or ruin the snow (warmth, rain).
 *
 * Known limitation (see questions-and-assumptions #4): weather can't tell us whether a ski
 * area exists. Elevation is used as a soft signal only.
 */
export class SkiScorer implements ActivityScorer {
  activity = Activity.Skiing;

  constructor(private rules: ScoringConfig['skiing']) {}

  score({ weather }: DayConditions, location: LocationContext): ScoreResult {
    const rules = this.rules;
    const category = categoriseWeatherCode(weather.weatherCode);

    return calculateScore(100, [
      this.snowCover(weather.snowDepthMaxM),
      adjustIf(
        weather.snowfallSumCm >= rules.freshSnowfall.minCm,
        rules.freshSnowfall.points,
        `Fresh snowfall ${formatNumber(weather.snowfallSumCm)} cm`,
      ),
      rampPenalty(
        weather.temperatureMaxC,
        rules.warmTempC,
        `Warm, slushy snow (max ${formatNumber(weather.temperatureMaxC)}°C)`,
      ),
      adjustIf(
        weather.temperatureMinC < rules.extremeCold.belowC,
        rules.extremeCold.points,
        `Extreme cold (min ${formatNumber(weather.temperatureMinC)}°C)`,
      ),
      rampPenalty(
        weather.windGustsMaxKmh,
        rules.gustsKmh,
        `Strong gusts ${formatNumber(weather.windGustsMaxKmh)} km/h may close lifts`,
      ),
      adjustIf(isWet(category), rules.rain.points, 'Rain on the slopes'),
      adjustIf(
        category === WeatherCategory.Thunderstorm,
        rules.thunderstorm.points,
        'Thunderstorms',
      ),
      adjustIf(category === WeatherCategory.Fog, rules.fog.points, 'Fog / poor visibility'),
      adjustIf(
        location.elevationM !== null && location.elevationM < rules.lowElevation.belowM,
        rules.lowElevation.points,
        `Low elevation (${formatNumber(location.elevationM ?? 0)} m), ski terrain unlikely`,
      ),
    ]);
  }

  private snowCover(depthM: number | null): Adjustment | null {
    if (depthM === null) {
      return { points: this.rules.unknownSnowDepth.points, reason: 'Snow depth unknown' };
    }
    return rampPenalty(
      depthM,
      this.rules.snowDepthM,
      `Thin snow cover (${formatNumber(depthM * 100)} cm)`,
    );
  }
}
