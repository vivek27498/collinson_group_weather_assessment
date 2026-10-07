/**
 * Scenario 1: steady traffic on popular, already-cached cities.
 * Question: what does the service cost per request when the cache is doing its job?
 */
import { HOT_CITIES, rank, resetUpstreamStats, upstreamStats } from './common.js';

export const options = {
  scenarios: {
    warm: { executor: 'constant-vus', vus: 50, duration: '30s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<100'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  HOT_CITIES.forEach((city) => rank(city)); // pre-warm the cache
  resetUpstreamStats();
}

export default function () {
  rank(HOT_CITIES[Math.floor(Math.random() * HOT_CITIES.length)]);
}

export function teardown() {
  // With a warm cache, steady traffic should cause zero upstream calls.
  console.log('upstream calls during the test: ' + JSON.stringify(upstreamStats()));
}
