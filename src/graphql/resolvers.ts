import type { RankingOutcome } from '../application/ranking-service';
import type { GeoLocation } from '../domain/types';
import type { GraphQLContext } from './context';

interface RankingInputArgs {
  readonly input: { readonly city: string; readonly countryCode?: string | null };
}

/**
 * Resolvers stay thin: hand the raw input to the use case (which validates it), and translate
 * the outcome into the schema's shape. No business logic lives here.
 */
export const resolvers = {
  Query: {
    activityRankings: async (
      _parent: unknown,
      { input }: RankingInputArgs,
      { rankingService }: GraphQLContext,
    ) => toGraphQL(await rankingService.rank(input)),
  },

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
