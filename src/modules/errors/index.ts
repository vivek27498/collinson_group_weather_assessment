/** Errors: one taxonomy and one policy, shared by every transport. */
export * from './app-error'; // Error taxonomy: transport-agnostic kinds and stable codes.
export * from './error-mapper'; // The single error policy: status, client message, log level.
