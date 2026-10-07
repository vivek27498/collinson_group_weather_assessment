/**
 * Scenario 3: realistic mix under rising load. 90% of requests are for popular (cached)
 * cities and 10% are for new cities (cold: geocode + forecast + marine + DB writes).
 * Arrival rate ramps 10 → 150 requests/s, then holds.
 * Question: where does latency start to bend, and do cold misses hurt warm requests?
 */
import { HOT_CITIES, randomLetters, rank } from './common.js';

export const options = {
  scenarios: {
    mixed: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 150, duration: '40s' },
        { target: 150, duration: '20s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:warm}': ['p(95)<150'],
    'http_req_duration{kind:cold}': ['p(95)<1500'],
  },
};

export function setup() {
  HOT_CITIES.forEach((city) => rank(city));
}

export default function () {
  if (Math.random() < 0.1) {
    rank('Coldcity' + randomLetters(8), { kind: 'cold' });
  } else {
    rank(HOT_CITIES[Math.floor(Math.random() * HOT_CITIES.length)], { kind: 'warm' });
  }
}
