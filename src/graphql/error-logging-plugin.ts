import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { mapError } from '../modules/errors';
import type { GraphQLContext } from './context';

/**
 * Logs every GraphQL error once, with the request id. mapError decides whether it's a
 * warning (expected, e.g. bad input) or an error (unexpected, e.g. a bug or Open-Meteo down).
 * format-error.ts decides what the CLIENT sees; this file decides what goes in OUR logs.
 */
export function errorLoggingPlugin(): ApolloServerPlugin<GraphQLContext> {
  return {
    requestDidStart() {
      return Promise.resolve({
        didEncounterErrors({ errors, contextValue, operationName }) {
          for (const error of errors) {
            const original = error.originalError ?? error;
            if (original instanceof GraphQLError) {
              // Syntax/validation errors: the client sent a bad query.
              contextValue.log.warn(
                { operationName, code: error.extensions.code, message: error.message },
                'GraphQL request rejected',
              );
              continue;
            }
            const mapped = mapError(original);
            const fields = { operationName, code: mapped.code, path: error.path };
            if (mapped.logLevel === 'error') {
              contextValue.log.error({ ...fields, err: original }, 'GraphQL operation failed');
            } else {
              contextValue.log.warn(fields, mapped.message);
            }
          }
          return Promise.resolve();
        },
      });
    },
  };
}
