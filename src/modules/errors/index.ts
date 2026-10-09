/** Error handling shared by REST and GraphQL. */
export * from './app-error'; // our error classes (ValidationError, NotFoundError, ...)
export * from './error-mapper'; // mapError: decides status code, client message and log level
