/** Express helpers: request ids, response envelope, central error handling. */
export * from './request-id'; // Safe request ids (log-injection proof).
export * from './respond'; // The REST response envelope.
export * from './error-handler'; // Central Express error middleware and 404 handler.
