import type { RankingOutcome } from '../application/ranking-service';
import type { GraphQLContext } from './context';

interface RankingInputArgs {
  readonly input: { readonly city: string; readonly countryCode?: string | null };
}

/**
 * Resolvers stay thin: translate GraphQL args into a use-case call, and the outcome back
 * into the schema's shape. No business logic lives here.
 */
export const resolvers = {
  Query: {
    activityRankings: async (
      _parent: unknown,
      { input }: RankingInputArgs,
      { rankingService }: GraphQLContext,
    ) => {
      const outcome = await rankingService.rank({
        name: input.city,
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      });
      return toGraphQL(outcome);
    },
  },

  RankingResult: {
    __resolveType: (result: { __typename: string }) => result.__typename,
  },
};

export function toGraphQL(outcome: RankingOutcome) {
  if (outcome.kind === 'locationNotFound') {
    return {
      __typename: 'LocationNotFound' as const,
      message: `No place found matching "${outcome.query.name}"`,
      query: outcome.query.name,
    };
  }
  const { location } = outcome;
  return {
    __typename: 'ActivityRankings' as const,
    location: {
      name: location.name,
      region: location.region,
      country: location.country,
      countryCode: location.countryCode,
      latitude: location.latitude,
      longitude: location.longitude,
      elevation: location.elevationM,
      timezone: location.timezone,
    },
    forecastFetchedAt: outcome.forecastFetchedAt.toISOString(),
    isStale: outcome.isStale,
    warnings: outcome.warnings,
    activities: outcome.activities,
  };
}
