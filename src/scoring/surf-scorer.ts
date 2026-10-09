import { Activity, type DayConditions } from '../types';
import { categoriseWeatherCode, WeatherCategory } from './weather-codes';
import type { ActivityScorer } from './activity-scorer';
import {
  adjustIf,
  calculateScore,
  formatNumber,
  notApplicable,
  rampPenalty,
  type ScoreResult,
} from './score';
import type { ScoringConfig } from '../config/scoring';

/**
 * Surfing needs rideable waves (roughly 1–2.5 m with a decent period) and not too much wind.
 *
 * No marine data means the point is inland (or off the Marine API's grid). That's
 * NOT_APPLICABLE, which is a different answer from "terrible" (questions-and-assumptions #5).
 *
 * Simplification: we don't model wind *direction* (offshore vs onshore), only strength.
 */
export class SurfScorer implements ActivityScorer {
  activity = Activity.Surfing;

  constructor(private rules: ScoringConfig['surfing']) {}

  score({ weather, marine }: DayConditions): ScoreResult {
    if (marine?.waveHeightMaxM == null) {
      return notApplicable('No sea-state data for this location (likely inland)');
    }
    const rules = this.rules;
    const height = marine.waveHeightMaxM;
    const period = marine.wavePeriodMaxS;

    return calculateScore(100, [
      rampPenalty(height, rules.smallWavesM, `Small waves (${formatNumber(height)} m)`),
      rampPenalty(
        height,
        rules.bigWavesM,
        `Big waves (${formatNumber(height)} m), experienced surfers only`,
      ),
      period === null
        ? null
        : rampPenalty(
            period,
            rules.shortPeriodS,
            `Short wave period (${formatNumber(period)} s), choppy`,
          ),
      rampPenalty(
        weather.windSpeedMaxKmh,
        rules.windKmh,
        `Strong wind ${formatNumber(weather.windSpeedMaxKmh)} km/h`,
      ),
      adjustIf(
        weather.temperatureMaxC < rules.coldAir.belowC,
        rules.coldAir.points,
        `Cold (max ${formatNumber(weather.temperatureMaxC)}°C), thick wetsuit needed`,
      ),
      adjustIf(
        categoriseWeatherCode(weather.weatherCode) === WeatherCategory.Thunderstorm,
        rules.thunderstorm.points,
        'Thunderstorms: lightning risk in the water',
      ),
    ]);
  }
}
