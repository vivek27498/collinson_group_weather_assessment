import type { RankingService } from '../application/ranking-service';
import type { Logger } from '../observability/logger';

/** Per-request context. Built fresh for every operation, so nothing leaks between requests. */
export interface GraphQLContext {
  readonly requestId: string;
  /** Request-scoped logger: every line it writes carries this request's id. */
  readonly log: Logger;
  readonly rankingService: RankingService;
}
