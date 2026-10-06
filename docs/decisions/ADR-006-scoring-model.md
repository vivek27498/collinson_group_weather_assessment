# ADR-006: Explainable, rule-based scoring

**Status:** accepted

## Context

We need a 0–100 suitability score per activity per day, and a weekly ranking. Nobody gave us a
definition of "good skiing weather". It's product judgement, so the model must be easy to read,
challenge and tune.

## Decision

- **Start at 100, apply named adjustments.** Each rule is either a _ramp_ (a linear penalty between
  two thresholds, capped) or a _fixed_ adjustment (fog -10). Each adjustment carries a human-readable
  reason, and the API returns those reasons ("Strong gusts 60 km/h may close lifts (-20)"), biggest first.
- **Thresholds live in config** (`src/config/scoring.ts`). The domain only owns their _type_.
  Tuning is a reviewable config diff, and tests can inject alternatives.
- **Strategy per activity** (`ActivityScorer`), wired in one registry. Scorers are pure functions of
  `(day, location)`: no I/O and no clock.
- **Indoor is composed from outdoor.** It starts at a baseline of 70 and gains 30% of the outdoor
  "deficit", so it naturally wins on a washout day. The two can never disagree about the weather.
- **NOT_APPLICABLE ≠ 0.** Surfing with no marine data returns `score: null`, ranks last and says why.
- **Weekly score = mean of the best 3 days.** Ranking order: applicable → weekly score → registry order
  (deterministic). A best-day tie goes to the earliest date.
- **Rating bands:** EXCELLENT ≥ 75, GOOD ≥ 55, FAIR ≥ 35, otherwise POOR.

## Alternatives considered

- **Weighted sum of normalised features**: compact, but the output is hard to explain to a user
  ("why 63?") and the weights are opaque.
- **An ML model**: no labelled data, and it can't be explained. Out of proportion for this problem.

## Known simplifications (documented, not hidden)

- **Surfing:** wind _direction_ (offshore vs onshore) and tides aren't modelled. Only wind strength,
  wave height and period are used.
- **Skiing:** weather can't tell us whether a ski area exists. Elevation is a soft penalty.
- **Daily aggregates hide intra-day timing** (a dry morning and a wet afternoon look the same).
  Hourly scoring is a possible extension.
