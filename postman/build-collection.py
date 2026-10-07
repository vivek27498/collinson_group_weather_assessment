"""
Generates weather-activity-ranking.postman_collection.json.

Kept as a script (rather than hand-editing JSON exported from Postman) so the collection is
reviewable in diffs and the queries stay in sync. Run: python postman/build-collection.py
"""
import json
import pathlib

FULL = """query Rank($input: RankingInput!) {
  activityRankings(input: $input) {
    __typename
    ... on ActivityRankings {
      location { name region country countryCode elevation timezone }
      alternatives { name region country countryCode }
      forecastFetchedAt
      isStale
      warnings
      activities {
        rank
        activity
        weeklyScore
        weeklyRating
        applicable
        bestDay
        days { date score rating reasons }
      }
    }
    ... on LocationNotFound { message query }
    ... on InvalidInput { message fieldErrors { field message } }
  }
}"""

SUMMARY = """query Summary($input: RankingInput!) {
  activityRankings(input: $input) {
    __typename
    ... on ActivityRankings {
      location { name country }
      activities { rank activity weeklyRating bestDay }
    }
  }
}"""


CACHE_QUERY = """query Cached($input: RankingInput!) {
  activityRankings(input: $input) {
    __typename
    ... on ActivityRankings {
      location { name country }
      forecastFetchedAt
      isStale
      activities { rank activity weeklyRating }
    }
  }
}"""


def tests_event(lines):
    return [{"listen": "test", "script": {"type": "text/javascript", "exec": lines}}]


def gql(name, desc, query, variables, tests, headers=None):
    return {
        "name": name,
        "event": tests_event(tests),
        "request": {
            "method": "POST",
            "description": desc,
            "header": [{"key": "Content-Type", "value": "application/json"}] + (headers or []),
            "body": {
                "mode": "graphql",
                "graphql": {"query": query, "variables": json.dumps(variables, indent=2)},
            },
            "url": {"raw": "{{baseUrl}}/graphql", "host": ["{{baseUrl}}"], "path": ["graphql"]},
        },
    }


def get(name, desc, path, tests):
    raw_path = path.split("?")[0]
    url = {"raw": "{{baseUrl}}" + path, "host": ["{{baseUrl}}"], "path": raw_path.strip("/").split("/")}
    if "?" in path:
        key, value = path.split("?", 1)[1].split("=", 1)
        url["query"] = [{"key": key, "value": value}]
    return {
        "name": name,
        "event": tests_event(tests),
        "request": {"method": "GET", "description": desc, "header": [], "url": url},
    }


RANKED_COMMON = [
    "const body = pm.response.json();",
    "const r = body.data && body.data.activityRankings;",
    "pm.test('HTTP 200 and no GraphQL errors', () => { pm.response.to.have.status(200); pm.expect(body.errors).to.be.undefined; });",
    "pm.test('Result is ActivityRankings', () => pm.expect(r.__typename).to.eql('ActivityRankings'));",
    "pm.test('All 4 activities ranked 1..4', () => pm.expect(r.activities.map(a => a.rank)).to.eql([1, 2, 3, 4]));",
    "pm.test('Applicable activities have 7 days and a best day', () => r.activities.filter(a => a.applicable).forEach(a => { pm.expect(a.days.length).to.eql(7); pm.expect(a.bestDay).to.match(/^\\d{4}-\\d{2}-\\d{2}$/); }));",
    "pm.test('Every day explains itself (reasons array)', () => r.activities.forEach(a => a.days.forEach(d => pm.expect(d.reasons).to.be.an('array'))));",
    "console.log(r.activities.map(a => a.rank + '. ' + a.activity + ': ' + a.weeklyScore + ' (' + a.weeklyRating + ') best ' + a.bestDay).join('\\n'));",
]

ITEMS = [
    {
        "name": "0. Health",
        "item": [
            get(
                "Liveness /healthz",
                "Process is up. Standard REST envelope with requestId.",
                "/healthz",
                [
                    "pm.test('200 ok envelope', () => { pm.response.to.have.status(200); const b = pm.response.json(); pm.expect(b.success).to.eql(true); pm.expect(b.data.status).to.eql('ok'); });",
                    "pm.test('Has x-request-id header', () => pm.response.to.have.header('x-request-id'));",
                ],
            ),
            get(
                "Readiness /readyz",
                "Should this instance get traffic? Turns 503 SHUTTING_DOWN while draining.",
                "/readyz",
                ["pm.test('200 ready', () => pm.expect(pm.response.json().data.status).to.eql('ready'));"],
            ),
        ],
    },
    {
        "name": "1. Plan the week (UC1-UC3)",
        "item": [
            gql(
                "Ski town - Chamonix",
                "UC1 rank activities, UC2 best day, UC3 reasons. Inland, so surfing should be NOT_APPLICABLE (UC4).",
                FULL,
                {"input": {"city": "Chamonix"}},
                RANKED_COMMON
                + [
                    "pm.test('Surfing is NOT_APPLICABLE inland, ranked last', () => { const s = r.activities.find(a => a.activity === 'SURFING'); pm.expect(s.applicable).to.eql(false); pm.expect(s.weeklyRating).to.eql('NOT_APPLICABLE'); pm.expect(s.rank).to.eql(4); });",
                ],
            ),
            gql(
                "Summary only - pick your fields",
                "GraphQL lets the client ask for just what it needs: a compact summary.",
                SUMMARY,
                {"input": {"city": "Chamonix"}},
                [
                    "const r = pm.response.json().data.activityRankings;",
                    "pm.test('Only the requested fields come back', () => pm.expect(Object.keys(r.activities[0]).sort()).to.eql(['activity', 'bestDay', 'rank', 'weeklyRating']));",
                ],
            ),
        ],
    },
    {
        "name": "2. Not applicable vs scored (UC4)",
        "item": [
            gql(
                "Surf town - Biarritz",
                "Coastal: surfing is scored from wave height/period and wind.",
                FULL,
                {"input": {"city": "Biarritz"}},
                RANKED_COMMON
                + [
                    "pm.test('Surfing is applicable on the coast', () => pm.expect(r.activities.find(a => a.activity === 'SURFING').applicable).to.eql(true));",
                ],
            ),
            gql(
                "Inland capital - Madrid",
                "No sea: surfing NOT_APPLICABLE with the reason, not a score of 0.",
                FULL,
                {"input": {"city": "Madrid"}},
                RANKED_COMMON
                + [
                    "pm.test('Surfing explains why it is not applicable', () => pm.expect(r.activities.find(a => a.activity === 'SURFING').days[0].reasons[0]).to.match(/inland/));",
                ],
            ),
        ],
    },
    {
        "name": "3. Bad-weather fallback (UC5)",
        "item": [
            gql(
                "Rainy city - Bergen",
                "One of Europe's rainiest cities. On wet days indoor sightseeing should outscore outdoor. Live data: exact results vary with the real forecast.",
                FULL,
                {"input": {"city": "Bergen", "countryCode": "NO"}},
                RANKED_COMMON
                + [
                    "pm.test('Indoor is always applicable and at least its baseline (70)', () => { const i = r.activities.find(a => a.activity === 'INDOOR_SIGHTSEEING'); pm.expect(i.applicable).to.eql(true); pm.expect(i.weeklyScore).to.be.at.least(70); });",
                    "pm.test('On any day where outdoor scores below 70, indoor scores higher', () => { const o = r.activities.find(a => a.activity === 'OUTDOOR_SIGHTSEEING'); const i = r.activities.find(a => a.activity === 'INDOOR_SIGHTSEEING'); o.days.forEach((d, n) => { if (d.score < 70) pm.expect(i.days[n].score).to.be.above(d.score); }); });",
                ],
            ),
        ],
    },
    {
        "name": "4. Unknown place (UC7)",
        "item": [
            gql(
                "Unknown city",
                "Expected outcome modelled as data (a union member), not as an error.",
                FULL,
                {"input": {"city": "Xyzzyqwv"}},
                [
                    "const body = pm.response.json();",
                    "pm.test('HTTP 200, no errors array', () => { pm.response.to.have.status(200); pm.expect(body.errors).to.be.undefined; });",
                    "pm.test('LocationNotFound with a helpful message', () => { const r = body.data.activityRankings; pm.expect(r.__typename).to.eql('LocationNotFound'); pm.expect(r.message).to.include('Xyzzyqwv'); });",
                ],
            ),
        ],
    },
    {
        "name": "5. Ambiguous names (UC6)",
        "item": [
            gql(
                "Paris - which one?",
                "Resolves to the best match (Paris, France) and lists other places called Paris, so the client can spot ambiguity.",
                FULL,
                {"input": {"city": "Paris"}},
                RANKED_COMMON
                + [
                    "pm.test('Resolved to Paris, France', () => pm.expect(r.location.countryCode).to.eql('FR'));",
                    "pm.test('Lists same-name alternatives, e.g. Paris, Texas', () => { pm.expect(r.alternatives.length).to.be.within(1, 5); pm.expect(r.alternatives.some(a => a.countryCode === 'US')).to.eql(true); });",
                ],
            ),
            gql(
                "Paris, US (countryCode picks it)",
                "Same name, disambiguated with countryCode (case-insensitive).",
                FULL,
                {"input": {"city": "Paris", "countryCode": "us"}},
                RANKED_COMMON
                + [
                    "pm.test('Resolved to a Paris in the US', () => pm.expect(r.location.countryCode).to.eql('US'));",
                ],
            ),
        ],
    },
    {
        "name": "6. Validation and security",
        "item": [
            gql(
                "SQL injection payload in city",
                "Allow-list validation rejects it before anything is looked up or stored.",
                FULL,
                {"input": {"city": "'; DROP TABLE locations;--"}},
                [
                    "const r = pm.response.json().data.activityRankings;",
                    "pm.test('InvalidInput on the city field', () => { pm.expect(r.__typename).to.eql('InvalidInput'); pm.expect(r.fieldErrors[0].field).to.eql('city'); });",
                ],
            ),
            gql(
                "XSS payload in city",
                "Same allow-list: markup is never accepted.",
                FULL,
                {"input": {"city": "<script>alert(1)</script>"}},
                [
                    "pm.test('InvalidInput', () => pm.expect(pm.response.json().data.activityRankings.__typename).to.eql('InvalidInput'));",
                ],
            ),
            gql(
                "Invalid countryCode",
                "Must be a 2-letter ISO code.",
                FULL,
                {"input": {"city": "Paris", "countryCode": "FRA"}},
                [
                    "const r = pm.response.json().data.activityRankings;",
                    "pm.test('InvalidInput on countryCode', () => { pm.expect(r.__typename).to.eql('InvalidInput'); pm.expect(r.fieldErrors[0].field).to.eql('countryCode'); });",
                ],
            ),
            gql(
                "Alias amplification (4 root fields)",
                "One request asking for many places via aliases would multiply upstream calls. Rejected during validation (max 3).",
                '{ a: activityRankings(input: {city: "Paris"}) { __typename } b: activityRankings(input: {city: "Rome"}) { __typename } c: activityRankings(input: {city: "Oslo"}) { __typename } d: activityRankings(input: {city: "Bern"}) { __typename } }',
                {},
                [
                    "pm.test('400 Too many root fields', () => { pm.response.to.have.status(400); pm.expect(pm.response.json().errors[0].message).to.match(/Too many root fields/); });",
                ],
            ),
        ],
    },
    {
        "name": "7. Persistence and caching (UC8)",
        "item": [
            gql(
                "First call - Lisbon (fetches or uses cache)",
                "Stores forecastFetchedAt so the next request can compare. On a cold cache this call goes to Open-Meteo and writes MySQL.",
                CACHE_QUERY,
                {"input": {"city": "Lisbon"}},
                [
                    "const r = pm.response.json().data.activityRankings;",
                    "pm.collectionVariables.set('lisbonFetchedAt', r.forecastFetchedAt);",
                    "pm.test('Ranked', () => pm.expect(r.__typename).to.eql('ActivityRankings'));",
                ],
            ),
            gql(
                "Second call - served from MySQL",
                "Same forecastFetchedAt as the first call = no new provider call. Compare the response times of the two requests.",
                CACHE_QUERY,
                {"input": {"city": "lisbon"}},
                [
                    "const r = pm.response.json().data.activityRankings;",
                    "pm.test('Same data as the first call (cache hit, case-insensitive key)', () => pm.expect(r.forecastFetchedAt).to.eql(pm.collectionVariables.get('lisbonFetchedAt')));",
                    "pm.test('Fresh (not stale)', () => pm.expect(r.isStale).to.eql(false));",
                    "pm.test('Fast (< 500 ms)', () => pm.expect(pm.response.responseTime).to.be.below(500));",
                ],
            ),
            get(
                "Readiness includes the database",
                "/readyz pings MySQL. Stop the DB container and it returns 503 DEPENDENCY_UNAVAILABLE.",
                "/readyz",
                ["pm.test('200 ready (DB reachable)', () => pm.expect(pm.response.json().data.status).to.eql('ready'));"],
            ),
        ],
    },
    {
        "name": "8. Errors and protocol",
        "item": [
            gql(
                "Invalid query (unknown field)",
                "GraphQL validation catches it before any of our code runs: 400 GRAPHQL_VALIDATION_FAILED.",
                '{ activityRankings(input: { city: "Paris" }) { nope } }',
                {},
                [
                    "pm.test('400 validation error', () => { pm.response.to.have.status(400); pm.expect(pm.response.json().errors[0].extensions.code).to.eql('GRAPHQL_VALIDATION_FAILED'); });",
                ],
            ),
            gql(
                "Missing required argument",
                "city is required (String!).",
                '{ activityRankings(input: { countryCode: "FR" }) { __typename } }',
                {},
                [
                    "pm.test('400 with a message naming the field', () => { pm.response.to.have.status(400); pm.expect(pm.response.json().errors[0].message).to.match(/city/); });",
                ],
            ),
            gql(
                "Your own request id is echoed",
                "Send x-request-id and find the same id in the response header and in the server logs.",
                SUMMARY,
                {"input": {"city": "London"}},
                [
                    "pm.test('x-request-id echoed', () => pm.expect(pm.response.headers.get('x-request-id')).to.eql('postman-trace-123'));",
                ],
                headers=[{"key": "x-request-id", "value": "postman-trace-123"}],
            ),
            get(
                "Unknown route",
                "Same JSON error envelope as every other error, never an HTML page.",
                "/does-not-exist",
                [
                    "pm.test('404 ROUTE_NOT_FOUND envelope', () => { pm.response.to.have.status(404); const b = pm.response.json(); pm.expect(b.success).to.eql(false); pm.expect(b.error.code).to.eql('ROUTE_NOT_FOUND'); pm.expect(b.meta.requestId).to.be.a('string'); });",
                ],
            ),
            get(
                "GET /graphql without preflight (CSRF protection)",
                "Apollo blocks simple GET requests that a malicious page could trigger cross-site.",
                "/graphql?query=%7B__typename%7D",
                [
                    "pm.test('400 CSRF block', () => { pm.response.to.have.status(400); pm.expect(pm.response.text()).to.match(/CSRF/i); });",
                ],
            ),
        ],
    },
]

COLLECTION = {
    "info": {
        "name": "Weather Activity Ranking",
        "description": "Checks for each business use case. Start the server (npm run dev), then Run collection. See docs/manual-testing.md.",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "variable": [{"key": "baseUrl", "value": "http://localhost:4000"}],
    "item": ITEMS,
}

if __name__ == "__main__":
    out = pathlib.Path(__file__).with_name("weather-activity-ranking.postman_collection.json")
    out.write_text(json.dumps(COLLECTION, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out.name}: {sum(len(f['item']) for f in ITEMS)} requests")
