import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { expressMiddleware } from '@as-integrations/express5';
import type { RequestHandler } from 'express';
import type { RankingService } from '../application/ranking-service';
import type { GraphQLContext } from './context';
import { formatGraphQLError } from './format-error';
import { errorLoggingPlugin } from './plugins/error-logging';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';
import { createValidationRules } from './validation-rules';

export interface GraphQLHandlerDeps {
  readonly rankingService: RankingService;
  readonly isProduction: boolean;
  readonly limits: { readonly maxDepth: number; readonly maxRootFields: number };
  readonly onError?: (code: string) => void;
}

export interface GraphQLHandler {
  readonly handler: RequestHandler;
  readonly stop: () => Promise<void>;
}

export async function createGraphQLHandler(deps: GraphQLHandlerDeps): Promise<GraphQLHandler> {
  const apollo = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    formatError: formatGraphQLError,
    validationRules: createValidationRules(deps.limits),
    // Batched HTTP requests ([{query}, {query}, ...]) stay disabled (Apollo's default): they would
    // bypass the per-request rate limit and root-field limit.
    allowBatchedHttpRequests: false,
    // Our graceful-shutdown controller owns process signals. Apollo's default handlers stop the
    // server and then re-send the signal to the process, which our controller sees as a second
    // Ctrl+C and force-exits, skipping the DB disconnect. Found by running `docker stop`.
    stopOnTerminationSignals: false,
    // Never put stack traces in responses, in any environment. They go to logs instead.
    includeStacktraceInErrorResponses: false,
    // Introspection powers Postman's schema explorer in dev. In production it's off, so the
    // full schema isn't handed to anyone who asks.
    introspection: !deps.isProduction,
    // csrfPrevention is on by default in Apollo 4+: requests must be JSON or carry a preflight header.
    plugins: [
      // No browser playground: it needs a relaxed CSP. Postman is our client.
      ApolloServerPluginLandingPageDisabled(),
      errorLoggingPlugin(deps.onError),
    ],
  });
  await apollo.start();

  const handler = expressMiddleware(apollo, {
    context: ({ req }) =>
      Promise.resolve({
        requestId: typeof req.id === 'string' ? req.id : 'unknown',
        log: req.log,
        rankingService: deps.rankingService,
      }),
  });

  return { handler, stop: () => apollo.stop() };
}
