/** Reusable HTTP client building blocks (no knowledge of Open-Meteo or weather). */
export * from './json-http-client'; // HTTP client port, typed upstream errors and the plain client.
export * from './retrying-json-client'; // Retry decorator (exponential backoff with full jitter).
