import { buildSchema, parse, validate, specifiedRules } from 'graphql';
import { createValidationRules, maxRootFields } from '../../../src/graphql/validation-rules';
import { typeDefs } from '../../../src/graphql/schema';

const schema = buildSchema(typeDefs);
const errorsFor = (
  query: string,
  rules = createValidationRules({ maxDepth: 6, maxRootFields: 3 }),
) => validate(schema, parse(query), [...specifiedRules, ...rules]).map((e) => e.message);

const RANK = (alias: string) =>
  `${alias}: activityRankings(input: { city: "Paris" }) { __typename }`;

describe('maxRootFields', () => {
  it('allows up to the limit', () => {
    expect(errorsFor(`{ ${RANK('a')} ${RANK('b')} ${RANK('c')} }`)).toEqual([]);
  });

  it('rejects aliased copies of the same field beyond the limit', () => {
    expect(errorsFor(`{ ${RANK('a')} ${RANK('b')} ${RANK('c')} ${RANK('d')} }`)).toEqual([
      'Too many root fields: 4 (max 3). Split the request or ask for fewer places.',
    ]);
  });

  it('counts fields hidden in named and inline fragments', () => {
    const query = `
      query { ...Two ... on Query { ${RANK('c')} ${RANK('d')} } }
      fragment Two on Query { ${RANK('a')} ${RANK('b')} }
    `;
    expect(errorsFor(query)).toEqual([
      'Too many root fields: 4 (max 3). Split the request or ask for fewer places.',
    ]);
  });

  it('does not count introspection fields', () => {
    expect(
      errorsFor(`{ __typename __schema { queryType { name } } ${RANK('a')} }`, [maxRootFields(1)]),
    ).toEqual([]);
  });
});

describe('depth limit', () => {
  const FULL = `{ activityRankings(input: { city: "Paris" }) {
    ... on ActivityRankings { activities { days { reasons } } } } }`;

  it('accepts our deepest real query at the default limit', () => {
    expect(errorsFor(FULL)).toEqual([]);
  });

  it('rejects a query deeper than the configured limit', () => {
    // The schema has no recursive types, so real queries are bounded by design; the depth limit
    // is defence-in-depth for future schema changes. A low limit proves the rule is wired.
    const errors = errorsFor(FULL, createValidationRules({ maxDepth: 2, maxRootFields: 3 }));

    expect(errors.join(' ')).toMatch(/exceeds maximum operation depth of 2/);
  });
});
