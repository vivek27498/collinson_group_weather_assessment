import { Writable } from 'node:stream';
import { createLogger, type Logger } from '../../src/modules/logger';

/** A real pino logger whose JSON lines are captured in memory, so tests can assert on logs. */
export function captureLogs(level = 'debug'): {
  logger: Logger;
  lines: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ level, destination });
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
