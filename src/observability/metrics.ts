import type { RequestHandler } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics: the numbers we'd alert and build dashboards on.
 *
 * Label values are always drawn from small, fixed sets (outcome names, upstream names, known
 * routes), never from user input such as city names. Unbounded label values would explode
 * metric cardinality and take down the monitoring system.
 */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'weather_' }); // CPU, memory, event-loop lag

  return {
    registry,

    httpRequestDuration: new Histogram({
      name: 'weather_http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),

    rankingOutcomes: new Counter({
      name: 'weather_ranking_outcomes_total',
      help: 'activityRankings results by outcome',
      labelNames: ['outcome'] as const, // ranked | locationNotFound | invalidInput
      registers: [registry],
    }),

    graphqlErrors: new Counter({
      name: 'weather_graphql_errors_total',
      help: 'GraphQL errors by code',
      labelNames: ['code'] as const,
      registers: [registry],
    }),

    forecastCache: new Counter({
      name: 'weather_forecast_cache_total',
      help: 'Forecast cache lookups by outcome',
      labelNames: ['outcome'] as const, // hit | stale | miss | expired
      registers: [registry],
    }),

    geocodeCache: new Counter({
      name: 'weather_geocode_cache_total',
      help: 'Geocode cache lookups by outcome',
      labelNames: ['outcome'] as const, // hit | miss
      registers: [registry],
    }),

    sharedFetches: new Counter({
      name: 'weather_forecast_shared_fetches_total',
      help: 'Requests that joined an in-flight fetch instead of calling the provider (single-flight)',
      registers: [registry],
    }),

    upstreamRequestDuration: new Histogram({
      name: 'weather_upstream_request_duration_seconds',
      help: 'Latency of each attempt against a dependency',
      labelNames: ['upstream', 'outcome'] as const, // outcome: success | timeout | network | http_status | invalid_response
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8],
      registers: [registry],
    }),

    upstreamRetries: new Counter({
      name: 'weather_upstream_retries_total',
      help: 'Retries against a dependency',
      labelNames: ['upstream'] as const,
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;

const KNOWN_ROUTES = new Set(['/graphql', '/healthz', '/readyz', '/metrics']);

/** Times every request. Unknown paths are bucketed as "other" to keep cardinality bounded. */
export function httpMetricsMiddleware(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const stop = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      stop({
        method: req.method,
        route: KNOWN_ROUTES.has(req.path) ? req.path : 'other',
        status_code: String(res.statusCode),
      });
    });
    next();
  };
}

export function metricsEndpoint(metrics: Metrics): RequestHandler {
  return async (_req, res) => {
    res.setHeader('content-type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  };
}
