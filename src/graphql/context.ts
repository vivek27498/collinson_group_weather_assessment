import type { RankingService } from '../services/ranking-service';
import type { Logger } from '../modules/logger';

/** Per-request context. Built fresh for every operation, so nothing leaks between requests. */
export interface GraphQLContext {
  requestId: string;
  /** Request-scoped logger: every line it writes carries this request's id. */
  log: Logger;
  rankingService: RankingService;
}
