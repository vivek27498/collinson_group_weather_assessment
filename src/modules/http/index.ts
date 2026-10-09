/** Reusable HTTP client code (knows nothing about Open-Meteo or weather). */
export * from './json-http-client'; // the JsonHttpClient interface, HttpRequestError and the axios client
export * from './retrying-json-client'; // adds retries with a growing, random delay
