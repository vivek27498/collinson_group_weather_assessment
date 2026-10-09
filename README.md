# Weather Activity Ranking

Type in a city or town, and this service tells you how good the **next 7 days** look for four activities:
**skiing, surfing, outdoor sightseeing and indoor sightseeing**. It ranks them, picks the best day for
each, and explains every score in plain words (e.g. _"Rain on the slopes (-25)"_).

Weather comes from the free [Open-Meteo](https://open-meteo.com) API (no API key needed) and is saved in
MySQL, so we don't call the API on every request.

> **How this was built** (reviewers, start here): [docs/worklog.md](docs/worklog.md) has dated notes,
> including what broke and why. [docs/ai-log.md](docs/ai-log.md) shows where I steered or overruled the AI.
> [docs/plan.md](docs/plan.md) is the plan I started with (folder names changed later; the worklog explains
> why). [docs/questions-and-assumptions.md](docs/questions-and-assumptions.md) lists the questions I'd ask a
> PM, and [docs/decisions/](docs/decisions/) holds the design decisions (ADRs).

---

## Run it in 3 steps

You only need **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (running) and **git**.

```bash
# 1. Get the code
git clone https://github.com/vivek27498/collinson_group_weather_assessment.git
cd collinson_group_weather_assessment

# 2. Start everything (database + app). The first run takes a few minutes to build.
docker compose up -d --build

# 3. Check it's ready: you should see "status":"ready"
curl http://localhost:4000/readyz
```

That's it. The API is at **http://localhost:4000/graphql**. No `.env` file or other setup is needed.

What step 2 does for you:

1. starts MySQL;
2. creates the database users;
3. creates the tables;
4. starts the app.

**Stop it:** `docker compose down` (your saved data is kept). **Start fresh:** `docker compose down -v` (deletes the data).

### Try your first request

The easiest way is the **Swagger file**: open [`openapi.yaml`](openapi.yaml) in
[editor.swagger.io](https://editor.swagger.io) (File → Import file). Pick `POST /graphql` → **Try it out** →
choose an example from the drop-down → **Execute**. There is one ready-made example per business use case,
each with a short description.

Or from a terminal (Git Bash / macOS / Linux):

```bash
curl -s http://localhost:4000/graphql -H 'Content-Type: application/json' --data '{
  "query": "query Rank($input: RankingInput!) { activityRankings(input: $input) { ... on ActivityRankings { location { name country } activities { rank activity weeklyRating bestDay } } } }",
  "variables": { "input": { "city": "Chamonix" } }
}'
```

Or with **Postman**: import `postman/weather-activity-ranking.postman_collection.json` and click
**Run collection** (22 requests with automatic checks). See [docs/manual-testing.md](docs/manual-testing.md).

> The first request for a new city takes 1–3 seconds (it fetches live weather). Asking again is almost
> instant, because the answer is now saved in MySQL.

### If something goes wrong

| Problem                                    | Fix                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `port is already allocated` (4000 or 3307) | Another app uses that port. Stop it, or change the left-hand port in `docker-compose.yml` (e.g. `'4001:4000'`).    |
| `Cannot connect to the Docker daemon`      | Start Docker Desktop and wait until it says "running".                                                             |
| `/readyz` doesn't answer yet               | Give it 20–30 seconds on the first start; check with `docker compose ps` and `docker compose logs app`.            |
| Want to see what the app is doing          | `docker compose logs -f app` shows every request, and whether data came from the database or live from Open-Meteo. |

---

## What it does (business use cases)

| #   | The user wants to…                                | What they get                                                                                              |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | **Plan the week:** what's the best activity here? | The 4 activities ranked 1–4, each with a weekly score (0–100) and a label (EXCELLENT / GOOD / FAIR / POOR) |
| 2   | **Pick the day**                                  | The best day for each activity, plus a score for every day                                                 |
| 3   | **Understand why**                                | Plain-English reasons for every score, biggest impact first                                                |
| 4   | **Know what's impossible:** can I surf in Madrid? | `NOT_APPLICABLE` with a reason (no sea nearby), never a misleading 0                                       |
| 5   | **Have a plan B on rainy days**                   | Indoor sightseeing scores higher the worse it is outside                                                   |
| 6   | **Get the right place:** which "Paris"?           | The place we picked, plus other places with the same name; add `countryCode` to choose                     |
| 7   | **Get clear feedback on mistakes**                | "Place not found" or "invalid input" as normal answers, never a crash                                      |
| 8   | **Get fast, reliable answers**                    | Saved data answers in milliseconds, and still works if Open-Meteo is down                                  |

**How a score works:** every day starts at 100. Rules take points away or add a few, for example:

- wind gusts from 40 to 80 km/h cost skiing up to 40 points;
- rain costs skiing 25 points;
- 6+ hours of sunshine gives outdoor sightseeing +5.

The score is kept between 0 and 100. The **weekly score** is the average of the **3 best days**, because you
only need a few good days to plan a trip. All thresholds live in one file,
[src/config/scoring.ts](src/config/scoring.ts), so they can be tuned without touching the logic.

**How saved data works:**

- Forecasts are reused for **3 hours**.
- Between 3 and 24 hours old, they're returned immediately (marked `isStale: true`) while a fresh copy is
  fetched in the background.
- Place lookups are kept for **30 days**, and "no such place" for **24 hours**.
- Nearby places (within about 11 km) share the same saved forecast.
- If 200 people ask for the same new city at once, Open-Meteo is called only **once**.

---

## What I assumed

These are the important ones. The full list, with reasons, is in [docs/questions-and-assumptions.md](docs/questions-and-assumptions.md).

- **"Paris"** means the top match from Open-Meteo (it ranks bigger places first). The answer always says which place was used.
- **Skiing** is scored on weather only. Weather can't tell us whether a ski resort exists; low altitude is just a small penalty.
- **Surfing inland** is "not applicable", not 0: impossible and terrible are different answers.
- **Indoor sightseeing** is always a decent option (it starts at 70) and gets better when outdoor gets worse.
- **Days** are the place's own local days, and units are metric (°C, km/h, mm).
- **Place names** may contain letters in any language, spaces, apostrophes, hyphens and dots. Digits are not allowed.
- **No login or user accounts:** weather isn't private data.
- **Open question:** indoor can rate EXCELLENT even in a sunny week. I'd check with the product owner whether that's the message we want.

---

## What I left out, and why

To keep the code small and easy to follow, I **removed** a few things I had built earlier. Their history and
findings are in the [worklog](docs/worklog.md).

| Removed              | Why it's fine for now                                                                       | Where it would go in production        |
| -------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| Prometheus metrics   | The logs already show cache vs live calls, timings and errors                               | A metrics module, or OpenTelemetry     |
| Per-IP rate limiting | A limit inside one app instance doesn't hold across several                                 | The API gateway or load balancer       |
| GitHub Actions (CI)  | The same checks run locally with one command (below)                                        | One workflow file                      |
| k6 load tests        | They found a real bug (fixed), and showed the database pool size matters (now configurable) | Back in, against a fake weather server |

**Not built on purpose:**

- user accounts and multi-tenancy;
- a UI;
- hourly scoring;
- wind direction and tides for surfing;
- a list of real ski resorts.

**Known simplifications:**

- daily figures hide what happens within a day;
- the saved place lookups are never deleted (a cleanup job would be needed at large scale).

**Next steps I'd take:**

1. A small in-memory cache in front of MySQL.
2. A shared lock so "call Open-Meteo once" also holds across several app instances.
3. Upgrade the MySQL driver once its open security advisories are fixed (see [ADR-004](docs/decisions/ADR-004-security-baseline.md)).

---

## For developers

### Run the app on your machine (without Docker for the app)

Needs **Node.js 22+** and Docker (for MySQL only).

```bash
npm ci                         # installs packages and generates the database client
cp .env.example .env           # PowerShell: Copy-Item .env.example .env
docker compose up -d mysql     # MySQL on port 3307
npx prisma migrate deploy      # creates the tables
npm run dev                    # http://localhost:4000, restarts when you edit code
```

(If the full Docker stack is already running, stop its app first with `docker compose stop app`: both use port 4000.)

### Checks and tests

```bash
npm run test:unit      # fast unit tests, no Docker needed
npm test               # all 338 tests (the integration tests start a throwaway MySQL in Docker)
npm run lint && npm run typecheck && npm run format:check && npm run build   # what CI would run
```

### Where things are

```
src/
  index.ts             starts the app (config, database, services, server, shutdown)
  create-services.ts   creates all services and connects them
  app.ts               Express: middleware and routes (/graphql, /healthz, /readyz)
  graphql/             the API schema and resolvers
  services/            the business flow, grouped by feature: ranking/, location/, forecast/
  scoring/             the scoring rules (pure functions); scorers/ has one file per activity
  providers/           calls to Open-Meteo
  repositories/        reading and writing MySQL (through Prisma)
  config/              environment variables and scoring thresholds
  modules/             reusable building blocks: http client, database, logger, errors, shutdown
  utils/               tiny helpers (clock, "run identical work once")
prisma/                database schema and migrations
openapi.yaml           Swagger file: one example per use case
```

**Tech stack:**

- Node.js 22, TypeScript, Express 5 and Apollo GraphQL;
- MySQL 8.4 with Prisma;
- Zod (input checks), pino (logs), Jest (tests).

The design decisions are explained in [docs/decisions/](docs/decisions/).
