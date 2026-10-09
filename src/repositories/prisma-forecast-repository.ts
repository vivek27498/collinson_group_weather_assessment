import type { ForecastRepository, ForecastSnapshot, MarineStatus } from '../services/interfaces';
import type { DayConditions } from '../types';
import { MarineStatus as DbMarineStatus, type DailyForecast } from '../generated/prisma/client';
import type { Database } from '../modules/database';

const TO_DB: Readonly<Record<MarineStatus, DbMarineStatus>> = {
  available: DbMarineStatus.AVAILABLE,
  none: DbMarineStatus.NONE,
  unavailable: DbMarineStatus.UNAVAILABLE,
};
const FROM_DB: Readonly<Record<DbMarineStatus, MarineStatus>> = {
  AVAILABLE: 'available',
  NONE: 'none',
  UNAVAILABLE: 'unavailable',
};

/** DATE columns hold local calendar days; we carry them as UTC-midnight Dates, never shifted. */
const toDbDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Stores forecasts in MySQL using Prisma. Prisma builds every query, so values are always sent
 * as separate parameters and never pasted into the SQL text (no SQL injection).
 */
export class PrismaForecastRepository implements ForecastRepository {
  constructor(private db: Database) {}

  async get(gridKey: string): Promise<ForecastSnapshot | null> {
    const row = await this.db.forecastSnapshot.findUnique({
      where: { gridKey },
      include: { days: { orderBy: { date: 'asc' } } },
    });
    if (!row) return null;

    const marineStatus = FROM_DB[row.marineStatus];
    return {
      gridKey: row.gridKey,
      latitude: row.latitude,
      longitude: row.longitude,
      fetchedAt: row.fetchedAt,
      marineStatus,
      days: row.days.map((day) => toDayConditions(day, marineStatus === 'available')),
    };
  }

  /**
   * Replace-on-refresh in one transaction: readers see either the old snapshot or the new one,
   * never a mix. (Snapshot first, because daily rows reference it.)
   */
  async save(snapshot: ForecastSnapshot): Promise<void> {
    const header = {
      latitude: snapshot.latitude,
      longitude: snapshot.longitude,
      fetchedAt: snapshot.fetchedAt,
      marineStatus: TO_DB[snapshot.marineStatus],
    };
    await this.db.$transaction([
      this.db.forecastSnapshot.upsert({
        where: { gridKey: snapshot.gridKey },
        create: { gridKey: snapshot.gridKey, ...header },
        update: header,
      }),
      this.db.dailyForecast.deleteMany({ where: { gridKey: snapshot.gridKey } }),
      this.db.dailyForecast.createMany({
        data: snapshot.days.map((day) => toRow(snapshot.gridKey, day)),
      }),
    ]);
  }
}

function toRow(gridKey: string, { weather, marine }: DayConditions) {
  return {
    gridKey,
    date: toDbDate(weather.date),
    weatherCode: weather.weatherCode,
    temperatureMaxC: weather.temperatureMaxC,
    temperatureMinC: weather.temperatureMinC,
    precipitationSumMm: weather.precipitationSumMm,
    precipitationProbabilityMaxPct: weather.precipitationProbabilityMaxPct,
    snowfallSumCm: weather.snowfallSumCm,
    snowDepthMaxM: weather.snowDepthMaxM,
    windSpeedMaxKmh: weather.windSpeedMaxKmh,
    windGustsMaxKmh: weather.windGustsMaxKmh,
    sunshineDurationS: weather.sunshineDurationS,
    uvIndexMax: weather.uvIndexMax,
    waveHeightMaxM: marine?.waveHeightMaxM ?? null,
    wavePeriodMaxS: marine?.wavePeriodMaxS ?? null,
    swellWaveHeightMaxM: marine?.swellWaveHeightMaxM ?? null,
  };
}

function toDayConditions(row: DailyForecast, hasSea: boolean): DayConditions {
  const date = fromDbDate(row.date);
  return {
    weather: {
      date,
      weatherCode: row.weatherCode,
      temperatureMaxC: row.temperatureMaxC,
      temperatureMinC: row.temperatureMinC,
      precipitationSumMm: row.precipitationSumMm,
      precipitationProbabilityMaxPct: row.precipitationProbabilityMaxPct,
      snowfallSumCm: row.snowfallSumCm,
      snowDepthMaxM: row.snowDepthMaxM,
      windSpeedMaxKmh: row.windSpeedMaxKmh,
      windGustsMaxKmh: row.windGustsMaxKmh,
      sunshineDurationS: row.sunshineDurationS,
      uvIndexMax: row.uvIndexMax,
    },
    marine: hasSea
      ? {
          date,
          waveHeightMaxM: row.waveHeightMaxM,
          wavePeriodMaxS: row.wavePeriodMaxS,
          swellWaveHeightMaxM: row.swellWaveHeightMaxM,
        }
      : null,
  };
}
