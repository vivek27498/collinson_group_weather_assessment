import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:4000';
export const MOCK_URL = __ENV.MOCK_URL || 'http://host.docker.internal:8089';

const QUERY = `query Rank($input: RankingInput!) {
  activityRankings(input: $input) {
    __typename
    ... on ActivityRankings { isStale activities { rank activity weeklyScore bestDay } }
  }
}`;

/** Letters only: city names must pass the service's input allow-list. */
export const HOT_CITIES = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliett',
  'Kilo',
  'Lima',
  'Mike',
  'November',
  'Oscar',
  'Papa',
  'Quebec',
  'Romeo',
  'Sierra',
  'Tango',
];

export function randomLetters(length) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < length; i++) out += letters[Math.floor(Math.random() * letters.length)];
  return out;
}

export function rank(city, tags = {}) {
  const res = http.post(
    BASE_URL + '/graphql',
    JSON.stringify({ query: QUERY, variables: { input: { city } } }),
    {
      headers: { 'content-type': 'application/json' },
      tags,
    },
  );
  check(res, {
    'status 200': (r) => r.status === 200,
    'ranked (no errors)': (r) => {
      const body = r.json();
      return body && !body.errors && body.data.activityRankings.__typename === 'ActivityRankings';
    },
  });
  return res;
}

export function resetUpstreamStats() {
  http.post(MOCK_URL + '/__reset');
}

export function upstreamStats() {
  return http.get(MOCK_URL + '/__stats').json();
}
