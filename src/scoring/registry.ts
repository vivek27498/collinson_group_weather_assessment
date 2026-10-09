import type { ActivityScorer } from './activity-scorer';
import { IndoorSightseeingScorer } from './indoor-sightseeing-scorer';
import { OutdoorSightseeingScorer } from './outdoor-sightseeing-scorer';
import type { ScoringConfig } from '../config/scoring';
import { SkiScorer } from './ski-scorer';
import { SurfScorer } from './surf-scorer';

/**
 * The list of all activities we score. The ranking code just loops over this list,
 * so adding a fifth activity means: write its scorer, then add one line here.
 * If two activities end up with exactly the same score, the one listed first ranks higher.
 */
export function createScorers(config: ScoringConfig): ActivityScorer[] {
  const outdoor = new OutdoorSightseeingScorer(config.outdoor);
  return [
    new SkiScorer(config.skiing),
    new SurfScorer(config.surfing),
    outdoor,
    new IndoorSightseeingScorer(config.indoor, outdoor),
  ];
}
