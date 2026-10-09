import type { RankingOutcome } from '../services/ranking-service';
import type { GeoLocation } from '../types';
import type { GraphQLContext } from './context';

interface RankingInputArgs {
  input: { city: string; countryCode?: string | null };
}

/**
 * Resolvers are the functions GraphQL calls to answer a query. Ours are kept tiny: pass the
 * input to RankingService (which validates it) and convert the result into the schema's shape.
 * No business logic lives here, so a REST endpoint could reuse RankingService unchanged.
 */
export const resolvers = {
  Query: {
    activityRankings: async (
      _parent: unknown,
      { input }: RankingInputArgs,
      { rankingService }: GraphQLContext,
    ) => toGraphQL(await rankingService.rank(input)),
  },

  // RankingResult can be one of three types; this tells GraphQL which one we returned.
  RankingResult: {
    __resolveType: (result: { __typename: string }) => result.__typename,
  },
};

export function toGraphQL(outcome: RankingOutcome) {
  switch (outcome.kind) {
    case 'invalidInput':
      return {
        __typename: 'InvalidInput' as const,
        message: 'The input is not valid. Nothing was looked up.',
        fieldErrors: outcome.errors.map((e) => ({ field: e.path ?? 'input', message: e.message })),
      };
    case 'locationNotFound':
      return {
        __typename: 'LocationNotFound' as const,
        message: `No place found matching "${outcome.query.name}"`,
        query: outcome.query.name,
      };
    case 'ranked':
      return {
        __typename: 'ActivityRankings' as const,
        location: toLocation(outcome.location),
        alternatives: outcome.alternatives.map(toLocation),
        forecastFetchedAt: outcome.forecastFetchedAt.toISOString(),
        isStale: outcome.isStale,
        warnings: outcome.warnings,
        activities: outcome.activities,
      };
  }
}

function toLocation(location: GeoLocation) {
  return {
    name: location.name,
    region: location.region,
    country: location.country,
    countryCode: location.countryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    elevation: location.elevationM,
    timezone: location.timezone,
  };
}
