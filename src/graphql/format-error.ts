import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { mapError } from '../modules/errors';

/**
 * Decides what a GraphQL client sees when something goes wrong. It uses mapError, the same
 * function the REST error handler uses, so both behave the same way.
 *  - GraphQL's own errors (bad syntax, unknown field) are the client's mistake: we keep their
 *    message and code, and drop anything internal.
 *  - Errors from our code go through mapError: expected ones (AppError) keep their message;
 *    anything else becomes a generic INTERNAL_ERROR, with no stack trace, SQL or hostnames.
 */
export function formatGraphQLError(
  formatted: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const original = unwrapResolverError(error);

  if (original instanceof GraphQLError) {
    const code = formatted.extensions?.code;
    return {
      message: formatted.message,
      locations: formatted.locations,
      path: formatted.path,
      extensions: code === undefined ? undefined : { code },
    };
  }

  const mapped = mapError(original);
  return {
    message: mapped.message,
    path: formatted.path,
    extensions: { code: mapped.code, details: mapped.details },
  };
}
