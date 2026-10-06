import { Activity, type DayConditions, type LocationContext } from '../types';
import { categoriseWeatherCode, isWet, WeatherCategory } from '../weather-codes';
import type { ActivityScorer } from './activity-scorer';
import { adjustIf, combine, fmt, rampPenalty, type Adjustment, type ScoreResult } from './score';
import type { ScoringConfig } from './scoring-config';

/**
 * Skiing cares most about snow on the ground, then about conditions that close lifts
 * (gusts, storms) or ruin the snow (warmth, rain).
 *
 * Known limitation (see questions-and-assumptions #4): weather can't tell us whether a ski
 * area exists. Elevation is used as a soft signal only.
 */
export class SkiScorer implements ActivityScorer {
  readonly activity = Activity.Skiing;

  constructor(private readonly rules: ScoringConfig['skiing']) {}

  score({ weather }: DayConditions, location: LocationContext): ScoreResult {
    const r = this.rules;
    const category = categoriseWeatherCode(weather.weatherCode);

    return combine(100, [
      this.snowCover(weather.snowDepthMaxM),
      adjustIf(
        weather.snowfallSumCm >= r.freshSnowfall.minCm,
        r.freshSnowfall.points,
        `Fresh snowfall ${fmt(weather.snowfallSumCm)} cm`,
      ),
      rampPenalty(
        weather.temperatureMaxC,
        r.warmTempC,
        `Warm, slushy snow (max ${fmt(weather.temperatureMaxC)}°C)`,
      ),
      adjustIf(
        weather.temperatureMinC < r.extremeCold.belowC,
        r.extremeCold.points,
        `Extreme cold (min ${fmt(weather.temperatureMinC)}°C)`,
      ),
      rampPenalty(
        weather.windGustsMaxKmh,
        r.gustsKmh,
        `Strong gusts ${fmt(weather.windGustsMaxKmh)} km/h may close lifts`,
      ),
      adjustIf(isWet(category), r.rain.points, 'Rain on the slopes'),
      adjustIf(category === WeatherCategory.Thunderstorm, r.thunderstorm.points, 'Thunderstorms'),
      adjustIf(category === WeatherCategory.Fog, r.fog.points, 'Fog / poor visibility'),
      adjustIf(
        location.elevationM !== null && location.elevationM < r.lowElevation.belowM,
        r.lowElevation.points,
        `Low elevation (${fmt(location.elevationM ?? 0)} m), ski terrain unlikely`,
      ),
    ]);
  }

  private snowCover(depthM: number | null): Adjustment | null {
    if (depthM === null) {
      return { points: this.rules.unknownSnowDepth.points, reason: 'Snow depth unknown' };
    }
    return rampPenalty(depthM, this.rules.snowDepthM, `Thin snow cover (${fmt(depthM * 100)} cm)`);
  }
}
