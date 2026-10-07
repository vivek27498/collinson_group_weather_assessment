import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { mapError } from '../../shared/errors/error-mapper';
import type { GraphQLContext } from '../context';

/**
 * Logs every GraphQL error once, with the request's id, at the level the shared error policy
 * chooses. formatError only shapes the *response*. Logging lives here because plugins can see
 * the request context (and therefore the request-scoped logger).
 */
export function errorLoggingPlugin(
  onError?: (code: string) => void,
): ApolloServerPlugin<GraphQLContext> {
  return {
    requestDidStart() {
      return Promise.resolve({
        didEncounterErrors({ errors, contextValue, operationName }) {
          for (const error of errors) {
            const original = error.originalError ?? error;
            if (original instanceof GraphQLError) {
              onError?.(
                typeof error.extensions.code === 'string' ? error.extensions.code : 'GRAPHQL_ERROR',
              );
              // Syntax/validation errors: the client sent a bad query.
              contextValue.log.warn(
                { operationName, code: error.extensions.code, message: error.message },
                'GraphQL request rejected',
              );
              continue;
            }
            const mapped = mapError(original);
            onError?.(mapped.code);
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
