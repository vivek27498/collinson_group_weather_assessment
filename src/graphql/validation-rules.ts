import depthLimit from 'graphql-depth-limit';
import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

/**
 * Limits on the shape of a query, checked BEFORE anything runs (no resolvers, no Open-Meteo calls).
 *
 * - Depth: rejects absurdly nested queries. Our real queries are about 4 levels deep.
 * - Root fields: each `activityRankings` field costs a geocoding and a forecast lookup, so an
 *   attacker could repeat it 500 times in one request using aliases
 *   (`{ a: activityRankings(...) b: activityRankings(...) ... }`). The depth limit doesn't catch
 *   that; this rule does. The 10 kb body limit is the final safety net.
 */
export function createValidationRules(limits: {
  maxDepth: number;
  maxRootFields: number;
}): ValidationRule[] {
  // graphql-depth-limit's typings return `any`; it is a standard ValidationRule at runtime.
  const depthRule = depthLimit(limits.maxDepth) as ValidationRule;
  return [depthRule, maxRootFields(limits.maxRootFields)];
}

export function maxRootFields(max: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => ({
    OperationDefinition(node) {
      const count = countRootFields(node.selectionSet, context);
      if (count > max) {
        context.reportError(
          new GraphQLError(
            `Too many root fields: ${count} (max ${max}). Split the request or ask for fewer places.`,
            { nodes: [node], extensions: { code: 'QUERY_TOO_COMPLEX' } },
          ),
        );
      }
    },
  });
}

/** Counts top-level fields, looking through fragments; introspection fields (__x) are free. */
function countRootFields(selectionSet: SelectionSetNode, context: ValidationContext): number {
  let count = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (!selection.name.value.startsWith('__')) count++;
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      count += countRootFields(selection.selectionSet, context);
    } else {
      const fragment = context.getFragment(selection.name.value);
      if (fragment) count += countRootFields(fragment.selectionSet, context);
    }
  }
  return count;
}
