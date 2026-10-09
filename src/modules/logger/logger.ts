import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { currentRequestContext } from './request-context';

export type { Logger };

/**
 * Structured JSON logs (one line per event) so they can be shipped to any log backend
 * and queried by field (requestId, code, durationMs) instead of grepped.
 * Anything that could carry a credential is redacted at the logger, not at call sites.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.databaseUrl',
  '*.DATABASE_URL',
];

export function createLogger(options: {
  level: LoggerOptions['level'];
  pretty?: boolean;
  /** Where to write (tests capture output here). Defaults to stdout. */
  destination?: DestinationStream;
}): Logger {
  const settings: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: 'weather-activity-ranking' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Every line logged while handling a request carries its id, even from components that were
    // built at startup with this root logger (see request-context.ts).
    mixin: () => {
      const context = currentRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
    ...(options.pretty && !options.destination ? { transport: { target: 'pino-pretty' } } : {}),
  };
  return options.destination ? pino(settings, options.destination) : pino(settings);
}
