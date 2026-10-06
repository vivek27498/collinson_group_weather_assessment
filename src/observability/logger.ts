import pino, { type Logger, type LoggerOptions } from 'pino';

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

export function createLogger(options: { level: LoggerOptions['level']; pretty?: boolean }): Logger {
  return pino({
    level: options.level ?? 'info',
    base: { service: 'weather-activity-ranking' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(options.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
