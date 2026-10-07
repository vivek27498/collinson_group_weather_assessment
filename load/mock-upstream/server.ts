/**
 * Mock Open-Meteo for load tests. We never load-test the real (free, rate-limited) API.
 *
 * - Serves recorded real payloads (test/fixtures/open-meteo) with configurable latency.
 * - Geocoding is synthetic and deterministic: each distinct name maps to its own coordinates
 *   (and so its own forecast grid cell), which lets k6 create cold cache misses on demand.
 * - Counts every call per endpoint: GET /__stats, POST /__reset. That's how the stampede test
 *   proves single-flight ("200 concurrent requests → 1 upstream call").
 *
 * Run: npx tsx load/mock-upstream/server.ts   (MOCK_PORT=8089, MOCK_LATENCY_MS=300)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.MOCK_PORT ?? 8089);
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 300);

const fixtures = path.join(__dirname, '..', '..', 'test', 'fixtures', 'open-meteo');
const forecast = readFileSync(path.join(fixtures, 'forecast-biarritz.json'), 'utf8');
const marine = readFileSync(path.join(fixtures, 'marine-biarritz.json'), 'utf8');

let hits: Record<string, number> = {};

function syntheticPlace(name: string) {
  const digest = createHash('sha256').update(name.toLowerCase()).digest();
  const n = digest.readUInt32BE(0);
  return {
    // Real GeoNames ids (what Open-Meteo returns) are < ~13 million and fit MySQL's signed INT.
    // An earlier version used the raw 32-bit hash and overflowed the column (see load-testing.md).
    id: (n % 10_000_000) + 1,
    name,
    // Spread across a 20° x 20° box in 0.25° steps so distinct names land in distinct grid cells.
    latitude: 30 + (n % 80) * 0.25,
    longitude: -10 + (Math.floor(n / 80) % 80) * 0.25,
    elevation: 100,
    country_code: 'FR',
    country: 'France',
    admin1: 'Mockland',
    timezone: 'Europe/Paris',
    population: 10_000,
  };
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/__stats') {
    send(res, 200, JSON.stringify(hits));
    return;
  }
  if (url.pathname === '/__reset') {
    hits = {};
    send(res, 200, '{}');
    return;
  }

  hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
  setTimeout(() => {
    switch (url.pathname) {
      case '/v1/search': {
        const name = url.searchParams.get('name') ?? '';
        const results = name.toLowerCase().startsWith('nowhere') ? [] : [syntheticPlace(name)];
        send(res, 200, JSON.stringify(results.length ? { results } : {}));
        return;
      }
      case '/v1/forecast': {
        send(res, 200, forecast);
        return;
      }
      case '/v1/marine': {
        send(res, 200, marine);
        return;
      }
      default: {
        send(res, 404, '{"error":true,"reason":"not found"}');
        return;
      }
    }
  }, LATENCY_MS);
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`mock upstream on :${PORT} (latency ${LATENCY_MS} ms)\n`);
});
