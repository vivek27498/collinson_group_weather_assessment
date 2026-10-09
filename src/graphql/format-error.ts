import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { mapError } from '../modules/errors';

/**
 * Apollo's formatError hook, delegating to THE shared error policy (same one the REST error
 * middleware uses). One policy, two transports:
 *  - GraphQL's own errors (syntax, validation, unknown field) are client mistakes: we keep
 *    their message and code, and strip anything internal.
 *  - Errors thrown by our code are mapped. Expected AppErrors keep their message and code;
 *    anything else becomes a generic INTERNAL_ERROR with no stack, SQL or hostnames.
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
      ...(formatted.locations ? { locations: formatted.locations } : {}),
      ...(formatted.path ? { path: formatted.path } : {}),
      ...(code === undefined ? {} : { extensions: { code } }),
    };
  }

  const mapped = mapError(original);
  return {
    message: mapped.message,
    ...(formatted.path ? { path: formatted.path } : {}),
    extensions: {
      code: mapped.code,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
  };
}
