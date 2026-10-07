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
 * Query-shape limits, checked during validation, before any resolver runs or any upstream call
 * is made.
 *
 * - Depth: stops pathologically nested queries. Our real queries are about 4 levels deep.
 * - Root fields: each `activityRankings` field triggers geocoding + forecast calls, so an
 *   attacker could alias it 500 times in one request
 *   (`{ a: activityRankings(...) b: activityRankings(...) ... }`). Depth limits don't catch
 *   that; this rule does. Body size (10kb) is the last backstop.
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
