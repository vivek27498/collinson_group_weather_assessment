# Manual testing with Postman

There's no UI, so Postman is the client. The collection has one request per business use case,
and each request carries automated assertions, so you can see pass/fail instead of eyeballing JSON.

## 1. Start the service

```powershell
npm ci
Copy-Item .env.example .env      # first time only
npm run dev                      # http://localhost:4000, pretty logs in this terminal
```

Slice 1 calls the live Open-Meteo API (no API key needed). MySQL isn't used until slice 3.

## 2. Import the collection

Postman → **Import** → `postman/weather-activity-ranking.postman_collection.json`.
The `baseUrl` collection variable defaults to `http://localhost:4000`.

- **Run everything:** right-click the collection → **Run collection** → **Run**. You should see 36 passing assertions.
- **Explore one request:** open it, click **Send**, then check the **Test Results** tab. The Chamonix,
  Biarritz, Madrid and Bergen requests also print a one-line-per-activity summary in the
  **Postman Console** (View → Show Postman Console).
- **Schema explorer:** in a GraphQL request's body, Postman fetches the schema by introspection
  (enabled in development only), so you get autocomplete and the field descriptions.

From the command line, the same run is: `npx newman run postman/weather-activity-ranking.postman_collection.json`

## 3. What each folder demonstrates

| Folder                      | Use case                            | What to look at                                                                                       |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0. Health                   | Ops                                 | The `{ success, data, meta.requestId }` envelope and the `x-request-id` header                        |
| 1. Plan the week            | UC1 rank, UC2 best day, UC3 reasons | `activities[].rank`, `bestDay`, `days[].reasons`. "Summary only" shows that clients pick their fields |
| 2. Not applicable vs scored | UC4                                 | Biarritz scores surfing; Madrid returns `NOT_APPLICABLE` with the reason, not 0                       |
| 3. Bad-weather fallback     | UC5                                 | Bergen: indoor beats outdoor on rainy days (live data, so it varies)                                  |
| 4. Unknown place            | UC7                                 | `__typename: "LocationNotFound"` comes back as **data**, with no `errors` array                       |
| 5. Errors and protocol      | Robustness                          | Validation errors (400), the 404 envelope, request-id echo, and the CSRF block on simple GETs         |

## 4. Simulating provider failures (needs a second terminal)

Upstream URLs come from config, so you can point one at a dead port and watch how the service behaves.

**Whole forecast provider down → clean error, with retries visible in the logs:**

```powershell
$env:PORT=4001; $env:OPEN_METEO_FORECAST_URL="http://127.0.0.1:9/v1/forecast"; npm run dev
```

Then send any ranking request to `http://localhost:4001/graphql` (change `baseUrl`). Expected:

- Response: `errors[0].extensions.code = "UPSTREAM_UNAVAILABLE"` and the message
  _"The weather provider is temporarily unavailable"_, with no hostnames or stack traces.
- Server log: two `Upstream call failed, retrying` warnings with jittered `delayMs`, then one
  `GraphQL operation failed` error that has the full cause and the request id.

**Only the marine API down → graceful degradation:**

```powershell
$env:PORT=4001; $env:OPEN_METEO_MARINE_URL="http://127.0.0.1:9/v1/marine"; npm run dev
```

Query Biarritz. Expected: the other three activities are ranked as normal, surfing is not applicable,
and `warnings` contains _"Sea-state data is temporarily unavailable, so surfing could not be scored."_

(Remove the variables afterwards with `Remove-Item Env:PORT, Env:OPEN_METEO_FORECAST_URL, Env:OPEN_METEO_MARINE_URL`.)

**Rate limiting:** start with `$env:RATE_LIMIT_MAX=3; npm run dev` and send any request 4 times. The 4th
returns HTTP 429 with `error.code = "RATE_LIMITED"`, and the response headers include `RateLimit-Policy` / `RateLimit`.

**Stale-while-revalidate:** start with `$env:FORECAST_FRESH_MINUTES=1; npm run dev`, query a city,
wait just over a minute, and query again. The response comes back instantly with `isStale: true`,
and the log shows a background refresh. Query once more and `isStale` is false with a newer `forecastFetchedAt`.

**Outage with cached data:** query a city, restart with `FORECAST_FRESH_MINUTES=1` and a dead
`OPEN_METEO_FORECAST_URL` (see above), wait a minute, and query again. You still get rankings,
with `isStale: true`, instead of an error.

**Inspect the cache:**
`docker compose exec mysql mysql -uapp -papp_dev_password weather -e "SELECT grid_key, marine_status, fetched_at FROM forecast_snapshots"`

## 5. Running the whole stack in Docker

```powershell
docker compose up -d --build     # MySQL -> migrate (as migrator) -> app (as app user)
```

The service is then on http://localhost:4000, and the same Postman collection works against it.
