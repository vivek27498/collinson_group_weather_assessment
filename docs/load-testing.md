# Load testing

## Setup

- **Never against the real Open-Meteo** (free, non-commercial, rate-limited). `load/mock-upstream/server.ts`
  serves recorded real payloads with **300 ms** of artificial latency, and counts every call per endpoint.
- **k6** in Docker (`grafana/k6`). Scenarios are in `load/k6/`. Raw summaries are in `load/results/*.json`.
- **App:** the production build (`node dist/index.js`, `NODE_ENV=production`, `LOG_LEVEL=warn`), one
  Node process, MySQL 8.4 in Docker. The rate limit is raised for the run because all k6 traffic comes from one IP.
- **Machine:** a Windows laptop with Docker Desktop. MySQL is reached through Docker Desktop's port
  forwarding, which measured **~5 ms per query round-trip**. On Linux, in the same network, that's
  typically well under 1 ms. Treat absolute numbers as this-laptop numbers; the _relative_ findings are what matter.

### How to run

```powershell
npx tsx load/mock-upstream/server.ts                                  # terminal 1 (port 8089)
$env:OPEN_METEO_GEOCODING_URL="http://127.0.0.1:8089/v1/search"       # terminal 2
$env:OPEN_METEO_FORECAST_URL="http://127.0.0.1:8089/v1/forecast"
$env:OPEN_METEO_MARINE_URL="http://127.0.0.1:8089/v1/marine"
$env:RATE_LIMIT_MAX="100000000"; $env:LOG_LEVEL="warn"; $env:NODE_ENV="production"
npm run build; node --env-file=.env dist/index.js
docker run --rm -v "${PWD}/load:/load" -e BASE_URL=http://host.docker.internal:4000 `
  -e MOCK_URL=http://host.docker.internal:8089 grafana/k6 run /load/k6/stampede.js   # or warm.js / mixed.js
```

## Results

| Scenario                                                       | Requests | Throughput | p50      | p95      | Errors | Upstream calls                       |
| -------------------------------------------------------------- | -------- | ---------- | -------- | -------- | ------ | ------------------------------------ |
| **Stampede** (before fix): 200 users, same new city            | 202      | 31 rps     | 6,257 ms | 6,343 ms | 0%     | search **200**, forecast 1, marine 1 |
| **Stampede** (after fix)                                       | 202      | 142 rps    | 1,221 ms | 1,327 ms | 0%     | search **1**, forecast 1, marine 1   |
| **Warm**: 50 users, 20 cached cities, 30 s, pool 10            | 3,772    | 69 rps     | 408 ms   | 479 ms   | 0%     | **0**                                |
| **Warm**, pool 20                                              | 6,104    | 200 rps    | 250 ms   | 332 ms   | 0%     | **0**                                |
| **Mixed**: 90% warm / 10% new cities, ramp to 150 rps, pool 20 | 6,168    | 100 rps    | 461 ms   | 1,791 ms | 0%     | ~1 per new city                      |

Mixed, by request kind: warm p95 **766 ms**, cold p95 **2.17 s**, with 51 iterations dropped at the 150 rps peak.
App metrics at the end of the run: forecast cache 11,702 hits / 568 misses, geocode cache 5,045 hits / 586 misses.

## What we learned (and what changed because of it)

1. **Geocoding wasn't single-flighted. Found by the stampede test, now fixed.** The forecast path made
   1 upstream call for 200 concurrent requests as designed, but geocoding made 200, and then 200
   transactions competed to upsert the same rows. p95 was 6.3 s. After adding single-flight to
   `CachedGeocoder`: **1 call per endpoint, p95 1.3 s (4.8× better)**, with a unit test to keep it that way.
2. **The best-effort cache degraded correctly.** In the first warm run, the mock returned 32-bit place
   ids that overflowed MySQL's `INT` id column (real GeoNames ids are < ~13 M). Every geocode cache
   write failed, but **every request still succeeded**: the service read through to the provider, the
   error was logged once per occurrence (515 identical lines), and the geocode-cache miss counter showed it.
   The mock was fixed. The behaviour under failure is exactly what ADR-003 intended.
3. **The warm path is bounded by DB round-trips, not by Node.** A cached request still makes 3 small
   queries (2 for the geocode cache, 1 for the forecast). A probe showed 200 parallel `SELECT 1`s
   taking 1,015 ms with the default pool and 512 ms with 20 connections. Doubling the pool nearly
   tripled warm throughput (69 → 200 rps).
4. **Cold misses slow down warm hits.** In the mixed run, cold requests (3 upstream calls plus
   transactional writes) share the connection pool with warm reads, which pushed warm p95 to 766 ms.

## Recommended next steps (in priority order)

1. **In-process L1 cache** (LRU, ~60 s TTL) in front of MySQL for snapshots and geocode results. Hot
   cities would then never touch the DB. Expected warm p95 is in single-digit milliseconds, and the pool is
   left for cold misses. Staleness across instances is bounded by the short TTL.
2. **Make pool size explicit config** (it's currently only reachable via `connectionLimit` in `DATABASE_URL`)
   and size it to the instance's concurrency.
3. **One query per geocode cache hit:** store the candidate locations denormalised in `geocode_queries`.
4. **Bound background-refresh concurrency** (a small queue), so a burst of cold misses can't starve reads.
5. **Re-run on Linux / in the same Docker network** before drawing capacity conclusions. The ~5 ms
   Docker Desktop round-trip inflates every DB-bound number here.
