import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import { currentRequestContext } from './request-context';

export type { Logger };

/**
 * Logs are written as JSON, one line per event, so a log tool can search them by field
 * (requestId, source, durationMs) instead of searching plain text.
 * Fields that could contain secrets are replaced with "[REDACTED]" automatically.
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
    // Adds the current request id to every log line automatically (see request-context.ts).
    mixin: () => {
      const context = currentRequestContext();
      return context ? { requestId: context.requestId } : {};
    },
    ...(options.pretty && !options.destination ? { transport: { target: 'pino-pretty' } } : {}),
  };
  return options.destination ? pino(settings, options.destination) : pino(settings);
}
