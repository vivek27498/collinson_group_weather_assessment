# ADR-003: Cache-aside with stale-while-revalidate and single-flight

**Status:** accepted (implemented in M5)

## Decision

- The cache key is a **grid cell** (lat/lon rounded to 0.1°, about 11 km), not the city name, so
  different spellings and neighbouring towns share data.
- Store **normalised daily weather**, not scores. Scores are computed on read, so changing the scoring
  rules never needs a backfill.
- Freshness:
  - Under 3h old: fresh, serve it.
  - 3–24h old: stale. Serve it with `isStale: true` and refresh in the background.
  - Over 24h old, or missing: fetch synchronously.
- **Single-flight**: concurrent requests for the same cell share one upstream call.
- If the provider is down and we have stale data, serve it flagged. Otherwise return `ForecastUnavailable`.

## Consequences / scale-out path

Single-flight works within one process. With multiple instances, MySQL `GET_LOCK()` or Redis would
coordinate refreshes. A scheduled pre-warm of popular cells is a further option. Both are noted here, not built.
