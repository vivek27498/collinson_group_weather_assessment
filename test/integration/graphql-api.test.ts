import type { Express } from 'express';
import { getIntrospectionQuery } from 'graphql';
import nock from 'nock';
import request from 'supertest';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config/env';
import { createServices } from '../../src/container';
import {
  createGraphQLHandler,
  type GraphQLHandler,
} from '../../src/graphql/create-graphql-handler';
import { createLogger } from '../../src/observability/logger';
import { loadFixture, type OpenMeteoFixture } from '../support/fixtures';
import {
  FakeClock,
  InMemoryForecastRepository,
  InMemoryGeocodeCache,
} from '../support/in-memory-repositories';

/**
 * End-to-end through the real wiring (Express → Apollo → RankingService → adapters → HTTP
 * client with retries). Only the network edge is faked: nock serves recorded Open-Meteo
 * payloads, and real outbound connections are blocked so tests never hit the live API.
 */
const GEOCODING = 'https://geocoding-api.open-meteo.com';
const FORECAST = 'https://api.open-meteo.com';
const MARINE = 'https://marine-api.open-meteo.com';

const RANK_QUERY = /* GraphQL */ `
  query Rank($input: RankingInput!) {
    activityRankings(input: $input) {
      __typename
      ... on ActivityRankings {
        location {
          name
          country
          countryCode
          region
          elevation
          timezone
        }
        alternatives {
          name
          country
          countryCode
          region
        }
        forecastFetchedAt
        isStale
        warnings
        activities {
          rank
          activity
          weeklyScore
          weeklyRating
          applicable
          bestDay
          days {
            date
            score
            rating
            reasons
          }
        }
      }
      ... on LocationNotFound {
        message
        query
      }
      ... on InvalidInput {
        message
        fieldErrors {
          field
          message
        }
      }
    }
  }
`;

interface Ranked {
  __typename: 'ActivityRankings';
  location: { name: string; country: string; countryCode: string };
  forecastFetchedAt: string;
  isStale: boolean;
  warnings: string[];
  activities: {
    rank: number;
    activity: string;
    weeklyScore: number | null;
    weeklyRating: string;
    applicable: boolean;
    bestDay: string | null;
    days: { date: string; score: number | null; rating: string; reasons: string[] }[];
  }[];
}

type RankedWithAlternatives = Ranked & {
  location: { region: string };
  alternatives: { countryCode: string; region: string }[];
};

interface InvalidInputResult {
  __typename: string;
  fieldErrors: { field: string; message: string }[];
}

const reply = (fixture: OpenMeteoFixture) =>
  [200, loadFixture(fixture) as Record<string, unknown>] as const;

function mockPlace(
  geocode: OpenMeteoFixture,
  forecast: OpenMeteoFixture,
  marine: OpenMeteoFixture,
) {
  nock(GEOCODING)
    .get('/v1/search')
    .query(true)
    .reply(...reply(geocode));
  nock(FORECAST)
    .get('/v1/forecast')
    .query(true)
    .reply(...reply(forecast));
  nock(MARINE)
    .get('/v1/marine')
    .query(true)
    .reply(...reply(marine));
}

interface TestApp {
  app: Express;
  graphql: GraphQLHandler;
  clock: FakeClock;
  forecasts: InMemoryForecastRepository;
  drain: () => Promise<void>;
}

async function buildApp(isProduction = false): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: isProduction ? 'production' : 'test',
    DATABASE_URL: 'mysql://app:x@localhost:3307/weather',
    UPSTREAM_MAX_RETRIES: '1',
    UPSTREAM_TIMEOUT_MS: '1000',
  });
  const logger = createLogger({ level: 'silent' });
  const clock = new FakeClock();
  const forecasts = new InMemoryForecastRepository();
  // The real object graph; only persistence is in-memory (the Prisma adapters have their own
  // Testcontainers tests) and the clock is controllable.
  const { rankingService, forecastService } = createServices(
    config,
    logger,
    { forecasts, geocodes: new InMemoryGeocodeCache() },
    clock,
  );
  const graphql = await createGraphQLHandler({
    rankingService,
    isProduction,
    limits: config.graphql,
  });
  return {
    app: createApp({ logger, graphqlHandler: graphql.handler }),
    graphql,
    clock,
    forecasts,
    drain: () => forecastService.drain(),
  };
}

const rank = (app: Express, input: Record<string, string>) =>
  request(app).post('/graphql').send({ query: RANK_QUERY, variables: { input } });

describe('GraphQL API: activityRankings', () => {
  let app: Express;
  let graphql: GraphQLHandler;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });
  // A fresh app (and empty cache) per test, so cached answers never leak between tests.
  beforeEach(async () => {
    ({ app, graphql } = await buildApp());
  });
  afterEach(async () => {
    nock.cleanAll();
    await graphql.stop();
  });
  afterAll(() => {
    nock.enableNetConnect();
  });

  describe('use cases 1–5: plan the week, pick the day, explain, not-applicable', () => {
    it('ranks all four activities for an inland mountain town (Chamonix)', async () => {
      mockPlace('geocode-chamonix', 'forecast-chamonix', 'marine-inland-chamonix');

      const res = await rank(app, { city: 'Chamonix' });

      expect(res.status).toBe(200);
      const result = (res.body as { data: { activityRankings: Ranked } }).data.activityRankings;
      expect(result).toMatchObject({
        __typename: 'ActivityRankings',
        location: { name: 'Chamonix', country: 'France', countryCode: 'FR' },
        isStale: false,
        warnings: [],
      });
      expect(Number.isNaN(Date.parse(result.forecastFetchedAt))).toBe(false);
      expect(result.activities.map((a) => a.rank)).toEqual([1, 2, 3, 4]);

      // Every applicable activity has 7 scored days with a best day.
      for (const a of result.activities.filter((x) => x.applicable)) {
        expect(a.days).toHaveLength(7);
        expect(a.bestDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // Inland → surfing is NOT_APPLICABLE (not 0), ranked last, with the reason.
      const surfing = result.activities.find((a) => a.activity === 'SURFING');
      expect(surfing).toMatchObject({
        rank: 4,
        applicable: false,
        weeklyScore: null,
        weeklyRating: 'NOT_APPLICABLE',
      });
      expect(surfing?.days[0]?.reasons).toEqual([
        'No sea-state data for this location (likely inland)',
      ]);

      // October in Chamonix: no snow on the ground → skiing is poor, and it says why.
      const skiing = result.activities.find((a) => a.activity === 'SKIING');
      expect(skiing?.weeklyRating).toBe('POOR');
      expect(skiing?.days[0]?.reasons[0]).toMatch(/Thin snow cover/);
    });

    it('scores surfing for a coastal town (Biarritz)', async () => {
      mockPlace('geocode-biarritz', 'forecast-biarritz', 'marine-biarritz');

      const res = await rank(app, { city: 'Biarritz' });

      const result = (res.body as { data: { activityRankings: Ranked } }).data.activityRankings;
      const surfing = result.activities.find((a) => a.activity === 'SURFING');
      expect(surfing?.applicable).toBe(true);
      expect(surfing?.weeklyScore).toBeGreaterThan(50);
    });
  });

  describe('use case 7: unknown place', () => {
    it('returns LocationNotFound as data, not as an error', async () => {
      nock(GEOCODING)
        .get('/v1/search')
        .query(true)
        .reply(...reply('geocode-empty'));

      const res = await rank(app, { city: 'Xyzzyqwv' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: {
          activityRankings: {
            __typename: 'LocationNotFound',
            message: 'No place found matching "Xyzzyqwv"',
            query: 'Xyzzyqwv',
          },
        },
      });
    });
  });

  describe('use case 6: ambiguous place names', () => {
    it('resolves "Paris" to France and lists same-name alternatives (Texas, ...)', async () => {
      mockPlace('geocode-paris', 'forecast-chamonix', 'marine-inland-chamonix');

      const res = await rank(app, { city: 'Paris' });

      const result = (res.body as { data: { activityRankings: RankedWithAlternatives } }).data
        .activityRankings;
      expect(result.location.countryCode).toBe('FR');
      expect(result.alternatives.length).toBeGreaterThan(0);
      expect(result.alternatives.length).toBeLessThanOrEqual(5);
      expect(result.alternatives).toContainEqual(
        expect.objectContaining({ countryCode: 'US', region: 'Texas' }),
      );
    });

    it('a countryCode picks the intended place, sent to the geocoder upper-cased', async () => {
      const geocode = nock(GEOCODING)
        .get('/v1/search')
        .query((q) => q.name === 'Paris' && q.countryCode === 'US')
        .reply(...reply('geocode-paris-us'));
      nock(FORECAST)
        .get('/v1/forecast')
        .query(true)
        .reply(...reply('forecast-chamonix'));
      nock(MARINE)
        .get('/v1/marine')
        .query(true)
        .reply(...reply('marine-inland-chamonix'));

      const res = await rank(app, { city: 'Paris', countryCode: 'us' });

      expect(geocode.isDone()).toBe(true);
      const result = (res.body as { data: { activityRankings: RankedWithAlternatives } }).data
        .activityRankings;
      expect(result.location).toMatchObject({ countryCode: 'US', region: 'Texas' });
    });
  });

  describe('input validation and injection payloads', () => {
    it.each([
      ["'; DROP TABLE locations;--"],
      ["Paris' OR '1'='1"],
      ['<script>alert(1)</script>'],
      [''],
    ])('returns InvalidInput for %p without calling any provider', async (city) => {
      // No nock interceptors are registered and real network is disabled: any outbound call
      // would fail this test.
      const res = await rank(app, { city });

      expect(res.status).toBe(200);
      const result = (res.body as { data: { activityRankings: InvalidInputResult } }).data
        .activityRankings;
      expect(result.__typename).toBe('InvalidInput');
      expect(result.fieldErrors[0]?.field).toBe('city');
    });

    it('reports an invalid countryCode', async () => {
      const res = await rank(app, { city: 'Paris', countryCode: 'FRA' });

      const result = (res.body as { data: { activityRankings: InvalidInputResult } }).data
        .activityRankings;
      expect(result.fieldErrors).toEqual([
        { field: 'countryCode', message: expect.any(String) as unknown },
      ]);
    });
  });

  describe('use case 8: persistence, caching and stale data', () => {
    let cached: TestApp;
    beforeEach(async () => {
      cached = await buildApp();
    });
    afterEach(async () => {
      await cached.graphql.stop();
    });

    it('serves the second request from the cache: no second provider call', async () => {
      mockPlace('geocode-chamonix', 'forecast-chamonix', 'marine-inland-chamonix'); // one reply each

      const first = await rank(cached.app, { city: 'Chamonix' });
      const second = await rank(cached.app, { city: 'chamonix' }); // case-insensitive cache key

      expect(nock.pendingMocks()).toEqual([]);
      const a = (first.body as { data: { activityRankings: Ranked } }).data.activityRankings;
      const b = (second.body as { data: { activityRankings: Ranked } }).data.activityRankings;
      expect(b.forecastFetchedAt).toBe(a.forecastFetchedAt);
      expect(b.isStale).toBe(false);
      expect(cached.forecasts.saves).toBe(1);
    });

    it('after 3h serves stale data (isStale) immediately and refreshes in the background', async () => {
      mockPlace('geocode-chamonix', 'forecast-chamonix', 'marine-inland-chamonix');
      await rank(cached.app, { city: 'Chamonix' });

      cached.clock.advance(3 * 3_600_000);
      nock(FORECAST)
        .get('/v1/forecast')
        .query(true)
        .reply(...reply('forecast-chamonix'));
      nock(MARINE)
        .get('/v1/marine')
        .query(true)
        .reply(...reply('marine-inland-chamonix'));
      const stale = await rank(cached.app, { city: 'Chamonix' });
      await cached.drain();

      expect(
        (stale.body as { data: { activityRankings: Ranked } }).data.activityRankings.isStale,
      ).toBe(true);
      expect(nock.pendingMocks()).toEqual([]); // the background refresh happened
      expect(cached.forecasts.saves).toBe(2);
    });

    it('provider outage while data is stale: still answers with isStale=true (no error)', async () => {
      mockPlace('geocode-chamonix', 'forecast-chamonix', 'marine-inland-chamonix');
      await rank(cached.app, { city: 'Chamonix' });

      cached.clock.advance(6 * 3_600_000);
      nock(FORECAST).get('/v1/forecast').query(true).times(2).reply(503);
      nock(MARINE).get('/v1/marine').query(true).times(2).reply(503);
      const res = await rank(cached.app, { city: 'Chamonix' });
      await cached.drain();

      const body = res.body as { data: { activityRankings: Ranked }; errors?: unknown };
      expect(body.errors).toBeUndefined();
      expect(body.data.activityRankings.isStale).toBe(true);
      expect(body.data.activityRankings.activities).toHaveLength(4);
    });
  });

  describe('provider failures', () => {
    it('degrades gracefully when only marine data is down', async () => {
      nock(GEOCODING)
        .get('/v1/search')
        .query(true)
        .reply(...reply('geocode-biarritz'));
      nock(FORECAST)
        .get('/v1/forecast')
        .query(true)
        .reply(...reply('forecast-biarritz'));
      nock(MARINE).get('/v1/marine').query(true).times(2).reply(503, 'Service Unavailable');

      const res = await rank(app, { city: 'Biarritz' });

      const result = (res.body as { data: { activityRankings: Ranked } }).data.activityRankings;
      expect(result.warnings).toEqual([
        'Sea-state data is temporarily unavailable, so surfing could not be scored.',
      ]);
      expect(result.activities.find((a) => a.activity === 'SURFING')?.applicable).toBe(false);
    });

    it('retries a failing forecast, then returns a clean UPSTREAM_UNAVAILABLE error (no leaks)', async () => {
      nock(GEOCODING)
        .get('/v1/search')
        .query(true)
        .reply(...reply('geocode-chamonix'));
      const forecast = nock(FORECAST)
        .get('/v1/forecast')
        .query(true)
        .times(2) // 1 attempt + 1 retry (UPSTREAM_MAX_RETRIES=1)
        .reply(500, 'stack trace at weather-db-07.internal:5432');
      nock(MARINE)
        .get('/v1/marine')
        .query(true)
        .reply(...reply('marine-inland-chamonix'));

      const res = await rank(app, { city: 'Chamonix' });

      expect(forecast.isDone()).toBe(true); // proves the retry happened
      expect(res.body).toEqual({
        data: null,
        errors: [
          {
            message: 'The weather provider is temporarily unavailable',
            path: ['activityRankings'],
            extensions: { code: 'UPSTREAM_UNAVAILABLE' },
          },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/weather-db|5432|stack/);
    });
  });

  describe('GraphQL protocol and security', () => {
    it('rejects an invalid query with a validation error, without calling the provider', async () => {
      const res = await request(app)
        .post('/graphql')
        .send({ query: '{ activityRankings(input: { city: "x" }) { nope } }' });

      expect(res.status).toBe(400);
      const body = res.body as { errors: { extensions: { code: string } }[] };
      expect(body.errors[0]?.extensions.code).toBe('GRAPHQL_VALIDATION_FAILED');
    });

    it('blocks CSRF-style GET requests without a preflight header', async () => {
      const res = await request(app).get('/graphql').query({ query: '{ __typename }' });

      expect(res.status).toBe(400);
      expect(res.text).toMatch(/CSRF/i);
    });

    it('rejects too many root fields (alias amplification) before calling any provider', async () => {
      const aliases = ['a', 'b', 'c', 'd']
        .map((alias) => `${alias}: activityRankings(input: { city: "Paris" }) { __typename }`)
        .join(' ');

      const res = await request(app)
        .post('/graphql')
        .send({ query: `{ ${aliases} }` });

      expect(res.status).toBe(400);
      const body = res.body as { errors: { message: string }[] };
      expect(body.errors[0]?.message).toMatch(/Too many root fields: 4 \(max 3\)/);
    });

    it('rejects batched requests (they would bypass per-request limits)', async () => {
      const res = await request(app)
        .post('/graphql')
        .send([{ query: '{ __typename }' }, { query: '{ __typename }' }]);

      expect(res.status).toBe(400);
    });

    it('allows introspection in development (Postman schema explorer)', async () => {
      const res = await request(app)
        .post('/graphql')
        .send({ query: '{ __schema { queryType { name } } }' });

      expect(res.body).toEqual({ data: { __schema: { queryType: { name: 'Query' } } } });
    });

    it('still allows the standard (deep) introspection query that Postman sends', async () => {
      const res = await request(app).post('/graphql').send({ query: getIntrospectionQuery() });

      expect(res.status).toBe(200);
      expect((res.body as { errors?: unknown }).errors).toBeUndefined();
    });

    it('disables introspection in production', async () => {
      const prod = await buildApp(true);
      try {
        const res = await request(prod.app)
          .post('/graphql')
          .send({ query: '{ __schema { queryType { name } } }' });

        const body = res.body as { errors: { message: string }[] };
        expect(body.errors[0]?.message).toMatch(/introspection/i);
      } finally {
        await prod.graphql.stop();
      }
    });
  });
});
