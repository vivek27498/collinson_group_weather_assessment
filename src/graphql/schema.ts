/**
 * Schema-first GraphQL. Descriptions are part of the contract: they show up in Postman's
 * schema explorer and in introspection, so they double as API documentation.
 */
export const typeDefs = /* GraphQL */ `
  #graphql
  type Query {
    """
    Rank how good the next 7 days are for skiing, surfing, and outdoor and indoor sightseeing
    at a city or town.
    """
    activityRankings(input: RankingInput!): RankingResult!
  }

  input RankingInput {
    "City or town name, e.g. \\"Chamonix\\"."
    city: String!
    "Optional ISO 3166-1 alpha-2 country code to disambiguate, e.g. \\"US\\" for Paris, Texas."
    countryCode: String
  }

  """
  Expected outcomes are union members, not errors: clients switch on __typename.
  Errors (the "errors" array) are reserved for real failures such as the weather provider being down.
  """
  union RankingResult = ActivityRankings | LocationNotFound | InvalidInput

  type ActivityRankings {
    "The place we resolved the query to. Check it: names can be ambiguous."
    location: Location!
    """
    Other places with the same name (up to 5). If the one you meant is here, query again with
    its countryCode.
    """
    alternatives: [Location!]!
    "When the forecast data was fetched from the provider (ISO 8601)."
    forecastFetchedAt: String!
    "True if served from cache after its freshness window because the provider was unavailable."
    isStale: Boolean!
    "Non-fatal issues, e.g. sea data temporarily unavailable."
    warnings: [String!]!
    "Best activity first."
    activities: [ActivityRanking!]!
  }

  type Location {
    name: String!
    region: String
    country: String
    countryCode: String
    latitude: Float!
    longitude: Float!
    "Metres above sea level."
    elevation: Float
    "IANA timezone. All dates are local calendar days in this timezone."
    timezone: String
  }

  type ActivityRanking {
    activity: Activity!
    "1 = best activity this week."
    rank: Int!
    "Mean of the best 3 days (0-100), or null if the activity isn't possible here."
    weeklyScore: Float
    weeklyRating: Rating!
    applicable: Boolean!
    "Local date (YYYY-MM-DD) of the best day, or null if not applicable."
    bestDay: String
    days: [DayScore!]!
  }

  type DayScore {
    "Local date, YYYY-MM-DD."
    date: String!
    "0-100, or null if the activity isn't possible here."
    score: Int
    rating: Rating!
    "Why the score is what it is, biggest impact first."
    reasons: [String!]!
  }

  type LocationNotFound {
    message: String!
    query: String!
  }

  "The input isn't a plausible place name or country code. Nothing was looked up."
  type InvalidInput {
    message: String!
    fieldErrors: [FieldError!]!
  }

  type FieldError {
    "Input field, e.g. city or countryCode."
    field: String!
    message: String!
  }

  enum Activity {
    SKIING
    SURFING
    OUTDOOR_SIGHTSEEING
    INDOOR_SIGHTSEEING
  }

  enum Rating {
    EXCELLENT
    GOOD
    FAIR
    POOR
    NOT_APPLICABLE
  }
`;
