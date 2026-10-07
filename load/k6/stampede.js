/**
 * Scenario 2: cache stampede. 200 users ask for the same never-seen city at the same moment
 * (e.g. a city trending on social media).
 * Question: does single-flight hold? We expect 1 call per upstream endpoint, not 200.
 */
import { check } from 'k6';
import { randomLetters, rank, resetUpstreamStats, upstreamStats } from './common.js';

export const options = {
  scenarios: {
    stampede: { executor: 'shared-iterations', vus: 200, iterations: 200, maxDuration: '60s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  resetUpstreamStats();
  return { city: 'Stampede' + randomLetters(8) }; // unique per run, so always a cold cache
}

export default function (data) {
  rank(data.city);
}

export function teardown() {
  const stats = upstreamStats();
  console.log('upstream calls for 200 concurrent cold requests: ' + JSON.stringify(stats));
  check(stats, {
    'forecast fetched once (single-flight)': (s) => s['/v1/forecast'] === 1,
    'marine fetched once (single-flight)': (s) => s['/v1/marine'] === 1,
    'geocoded once (single-flight)': (s) => s['/v1/search'] === 1,
  });
}
