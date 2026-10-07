# ADR-003: Cache-aside with stale-while-revalidate and single-flight

**Status:** implemented (slice 3): `src/application/forecast-service.ts`, `cached-geocoder.ts`, `single-flight.ts`

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
- If the provider is down and we have stale data, serve it flagged. Otherwise the request fails with a
  clean `UPSTREAM_UNAVAILABLE` error. It's a genuine failure, so it goes in GraphQL `errors`, not a union member.

## Additions made while implementing

- **Degraded snapshots:** if the marine API failed at fetch time, the snapshot is stored with
  `marine_status = UNAVAILABLE` and is only fresh for 15 minutes, so sea data is retried soon.
- **Geocoding is cached too** (30 days), including "not found" (24 hours, negative caching).
- **The database is an optimisation, not a dependency:** cache read/write failures are logged
  and we read through to the provider. `/readyz` still reports the DB, so a load balancer can
  route around an instance with a broken DB.
- **One row per cell, replaced on refresh, in one transaction.** History isn't a requirement, so
  there's no pruning job.
- **Graceful shutdown drains in-flight background refreshes** before closing the DB pool.

## Consequences / scale-out path

Single-flight works within one process. With multiple instances, MySQL `GET_LOCK()` or Redis would
coordinate refreshes. A scheduled pre-warm of popular cells is a further option. Both are noted here, not built.
