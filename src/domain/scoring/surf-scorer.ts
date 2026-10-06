import { Activity, type DayConditions } from '../types';
import { categoriseWeatherCode, WeatherCategory } from '../weather-codes';
import type { ActivityScorer } from './activity-scorer';
import { adjustIf, combine, fmt, notApplicable, rampPenalty, type ScoreResult } from './score';
import type { ScoringConfig } from './scoring-config';

/**
 * Surfing needs rideable waves (roughly 1–2.5 m with a decent period) and not too much wind.
 *
 * No marine data means the point is inland (or off the Marine API's grid). That's
 * NOT_APPLICABLE, which is a different answer from "terrible" (questions-and-assumptions #5).
 *
 * Simplification: we don't model wind *direction* (offshore vs onshore), only strength.
 */
export class SurfScorer implements ActivityScorer {
  readonly activity = Activity.Surfing;

  constructor(private readonly rules: ScoringConfig['surfing']) {}

  score({ weather, marine }: DayConditions): ScoreResult {
    if (marine?.waveHeightMaxM == null) {
      return notApplicable('No sea-state data for this location (likely inland)');
    }
    const r = this.rules;
    const height = marine.waveHeightMaxM;
    const period = marine.wavePeriodMaxS;

    return combine(100, [
      rampPenalty(height, r.smallWavesM, `Small waves (${fmt(height)} m)`),
      rampPenalty(height, r.bigWavesM, `Big waves (${fmt(height)} m), experienced surfers only`),
      period === null
        ? null
        : rampPenalty(period, r.shortPeriodS, `Short wave period (${fmt(period)} s), choppy`),
      rampPenalty(
        weather.windSpeedMaxKmh,
        r.windKmh,
        `Strong wind ${fmt(weather.windSpeedMaxKmh)} km/h`,
      ),
      adjustIf(
        weather.temperatureMaxC < r.coldAir.belowC,
        r.coldAir.points,
        `Cold (max ${fmt(weather.temperatureMaxC)}°C), thick wetsuit needed`,
      ),
      adjustIf(
        categoriseWeatherCode(weather.weatherCode) === WeatherCategory.Thunderstorm,
        r.thunderstorm.points,
        'Thunderstorms: lightning risk in the water',
      ),
    ]);
  }
}
