import type { ActivityScorer } from './activity-scorer';
import { IndoorSightseeingScorer } from './indoor-sightseeing-scorer';
import { OutdoorSightseeingScorer } from './outdoor-sightseeing-scorer';
import type { ScoringConfig } from './scoring-config';
import { SkiScorer } from './ski-scorer';
import { SurfScorer } from './surf-scorer';

/**
 * The one place that knows which activities exist. Ranking code iterates whatever is
 * registered, so a fifth activity is: write a scorer, add one line here.
 * Order is the deterministic tie-break when two activities score identically.
 */
export function createScorers(config: ScoringConfig): readonly ActivityScorer[] {
  const outdoor = new OutdoorSightseeingScorer(config.outdoor);
  return [
    new SkiScorer(config.skiing),
    new SurfScorer(config.surfing),
    outdoor,
    new IndoorSightseeingScorer(config.indoor, outdoor),
  ];
}
