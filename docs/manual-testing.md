# Testing by hand: Postman and failure drills

The README shows how to start the app and the Swagger file (`openapi.yaml`) has one example per use case.
This page adds two things: the **Postman collection** (with automatic pass/fail checks) and **how to
simulate outages** to see the app cope.

## 1. Postman collection

Postman → **Import** → `postman/weather-activity-ranking.postman_collection.json`.
The `baseUrl` variable defaults to `http://localhost:4000`.

- **Run everything:** right-click the collection → **Run collection** → **Run**. Expect **22 requests, 58 passing checks**.
- **One request:** open it, click **Send**, then look at the **Test Results** tab.
- **Same run from a terminal:** `npx newman run postman/weather-activity-ranking.postman_collection.json`

| Folder                      | Use case                     | What to look at                                                                        |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| 0. Health                   | Ops                          | The `{ success, data, meta.requestId }` response and the `x-request-id` header         |
| 1. Plan the week            | Rank, best day, reasons      | `activities[].rank`, `bestDay`, `days[].reasons`; "Summary only" asks for fewer fields |
| 2. Not applicable vs scored | Surfing inland vs at the sea | Biarritz scores surfing; Madrid returns `NOT_APPLICABLE` with the reason, not 0        |
| 3. Bad-weather fallback     | Plan B                       | Bergen: indoor beats outdoor on rainy days (live data, so it varies)                   |
| 4. Unknown place            | Not found                    | `__typename: "LocationNotFound"` comes back as normal data, not an error               |
| 5. Ambiguous names          | Which "Paris"?               | `location` + `alternatives`; `countryCode` picks Paris, Texas                          |
| 6. Validation and security  | Bad input                    | Injection attempts → `InvalidInput`; 4 places in one request → 400                     |
| 7. Saved data               | Speed                        | The second call returns the same `forecastFetchedAt`, much faster                      |

## 2. Simulating outages (run the app with `npm run dev`, see the README)

Open-Meteo's addresses come from config, so you can point one at a dead port and watch what happens.
The commands are for PowerShell; in Git Bash use `PORT=4001 OPEN_METEO_FORECAST_URL=... npm run dev`.

**The weather provider is down → a clean error, with retries visible in the logs:**

```powershell
$env:PORT=4001; $env:OPEN_METEO_FORECAST_URL="http://127.0.0.1:9/v1/forecast"; npm run dev
```

Query a city you haven't queried before on `http://localhost:4001/graphql`. Expected:

- Response: `errors[0].extensions.code = "UPSTREAM_UNAVAILABLE"`, message _"The weather provider is
  temporarily unavailable"_, with no hostnames or stack traces.
- Logs: an `Upstream call failed, retrying` warning, then one `GraphQL operation failed` error with the
  full cause and the request id.

**Only the sea forecast is down → only surfing is affected:**

```powershell
$env:PORT=4001; $env:OPEN_METEO_MARINE_URL="http://127.0.0.1:9/v1/marine"; npm run dev
```

Query a coastal city you haven't queried before. Expected: the other three activities are ranked as normal,
surfing is not applicable, and `warnings` contains _"Sea-state data is temporarily unavailable, so surfing
could not be scored."_

**Older saved data is served while refreshing:** start with `$env:FORECAST_FRESH_MINUTES=1; npm run dev`,
query a city, wait just over a minute, and query again. The answer comes back instantly with
`isStale: true`, and the log shows a background refresh. Query once more: `isStale` is false again.

**Provider down, but data is saved:** query a city, restart with `FORECAST_FRESH_MINUTES=1` and a dead
`OPEN_METEO_FORECAST_URL` (see above), wait a minute, and query again. You still get rankings
(`isStale: true`) instead of an error.

Afterwards: `Remove-Item Env:PORT, Env:OPEN_METEO_FORECAST_URL, Env:OPEN_METEO_MARINE_URL, Env:FORECAST_FRESH_MINUTES`.

## 3. Looking inside the database

```bash
docker compose exec mysql mysql -uapp -papp_dev_password weather -e "SELECT name, country_code, fetched_at FROM geocode_queries"
docker compose exec mysql mysql -uapp -papp_dev_password weather -e "SELECT grid_key, marine_status, fetched_at FROM forecast_snapshots"
```
