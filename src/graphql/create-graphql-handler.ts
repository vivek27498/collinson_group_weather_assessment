import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { expressMiddleware } from '@as-integrations/express5';
import type { RequestHandler } from 'express';
import type { RankingService } from '../services/ranking-service';
import type { GraphQLContext } from './context';
import { formatGraphQLError } from './format-error';
import { errorLoggingPlugin } from './error-logging-plugin';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';
import { createValidationRules } from './validation-rules';

export interface GraphQLHandlerOptions {
  rankingService: RankingService;
  isProduction: boolean;
  limits: { maxDepth: number; maxRootFields: number };
}

export interface GraphQLHandler {
  handler: RequestHandler;
  stop: () => Promise<void>;
}

export async function createGraphQLHandler(
  options: GraphQLHandlerOptions,
): Promise<GraphQLHandler> {
  const apollo = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    formatError: formatGraphQLError,
    validationRules: createValidationRules(options.limits),
    // Don't accept several queries in one HTTP request ([{query}, {query}, ...]): that would get
    // around the "max root fields" limit. (Off is also Apollo's default.)
    allowBatchedHttpRequests: false,
    // Our own shutdown code handles Ctrl+C / `docker stop`. Apollo's built-in handler re-sends the
    // signal, which our code saw as a second Ctrl+C and exited immediately, skipping the database
    // disconnect. Found by actually running `docker stop`.
    stopOnTerminationSignals: false,
    // Never put stack traces in responses, in any environment. They go to logs instead.
    includeStacktraceInErrorResponses: false,
    // Introspection powers Postman's schema explorer in dev. In production it's off, so the
    // full schema isn't handed to anyone who asks.
    introspection: !options.isProduction,
    // CSRF protection is on by default: requests must be JSON or carry a special header, so a
    // malicious web page can't quietly send queries using a visitor's browser.
    plugins: [
      // No browser playground: it needs a relaxed CSP. Postman is our client.
      ApolloServerPluginLandingPageDisabled(),
      errorLoggingPlugin(),
    ],
  });
  await apollo.start();

  const handler = expressMiddleware(apollo, {
    context: ({ req }) =>
      Promise.resolve({
        requestId: typeof req.id === 'string' ? req.id : 'unknown',
        log: req.log,
        rankingService: options.rankingService,
      }),
  });

  return { handler, stop: () => apollo.stop() };
}
