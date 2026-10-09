import { EventEmitter } from 'node:events';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger } from '../../../../src/modules/logger';
import { setupGracefulShutdown } from '../../../../src/modules/lifecycle';

const logger = createLogger({ level: 'silent' });

/** A fake server whose close() finishes straight away (or never, if `stuck`). */
function fakeServer(calls: string[], stuck = false) {
  const server = {
    close: jest.fn((done: () => void) => {
      calls.push('server');
      if (!stuck) done();
    }),
    closeIdleConnections: jest.fn(),
  };
  return server as typeof server & Server;
}

function setup(options: { failCleanup?: boolean; stuck?: boolean } = {}) {
  const calls: string[] = [];
  const events = new EventEmitter();
  const exit = jest.fn();
  const cleanup = jest.fn(() => {
    calls.push('cleanup');
    return options.failCleanup ? Promise.reject(new Error('db close failed')) : Promise.resolve();
  });
  const server = fakeServer(calls, options.stuck);
  const shutdown = setupGracefulShutdown({
    server,
    logger,
    cleanup,
    exit,
    events,
    timeoutMs: 5_000,
  });
  // Signals are handled asynchronously; this waits for the shutdown steps to run.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { calls, events, exit, cleanup, server, shutdown, settle };
}

describe('setupGracefulShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'])(
    'on %s: closes the server, then cleans up, then exits 0',
    async (signal) => {
      const { calls, events, exit, shutdown, settle } = setup();

      expect(shutdown.isShuttingDown()).toBe(false);
      events.emit(signal);
      expect(shutdown.isShuttingDown()).toBe(true);
      await settle();

      expect(calls).toEqual(['server', 'cleanup']);
      expect(exit).toHaveBeenCalledWith(0);
    },
  );

  it('only shuts down once, even if several signals arrive', async () => {
    const { events, exit, cleanup, settle } = setup();

    events.emit('SIGTERM');
    events.emit('SIGINT');
    await settle();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 if cleanup fails', async () => {
    const { events, exit, settle } = setup({ failCleanup: true });

    events.emit('SIGTERM');
    await settle();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when shutting down takes too long', () => {
    jest.useFakeTimers();
    try {
      const { events, exit } = setup({ stuck: true }); // server.close() never finishes

      events.emit('SIGTERM');
      jest.advanceTimersByTime(4_999);
      expect(exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['unhandledRejection', new Error('forgot to await'), 'Unhandled promise rejection'],
    ['uncaughtException', new TypeError('x is undefined'), 'Uncaught exception'],
  ])('on %s: logs it as fatal, shuts down and exits 1', async (event, error, message) => {
    const fatal = jest.spyOn(logger, 'fatal');
    const { events, exit, cleanup, settle } = setup();

    events.emit(event, error);
    await settle();

    expect(fatal).toHaveBeenCalledWith({ err: error }, message);
    expect(cleanup).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    fatal.mockRestore();
  });

  it('lets an in-flight request finish while refusing new ones (real server)', async () => {
    let releaseSlowRequest: () => void = () => undefined;
    const server = http.createServer((_req, res) => {
      releaseSlowRequest = () => res.end('done');
    });
    // Pin to IPv4: on dual-stack hosts a refusal can otherwise surface as an empty AggregateError.
    const host = '127.0.0.1';
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const { port } = server.address() as AddressInfo;
    const get = (): Promise<string> =>
      new Promise((resolve, reject) => {
        http
          .get({ host, port, agent: false }, (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => {
              resolve(body);
            });
          })
          .on('error', reject);
      });

    const events = new EventEmitter();
    const exit = jest.fn();
    setupGracefulShutdown({ server, logger, cleanup: () => Promise.resolve(), exit, events });

    try {
      const inFlight = get();
      await new Promise((resolve) => setTimeout(resolve, 50)); // the request reaches the handler

      events.emit('SIGTERM');

      await expect(get()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      expect(exit).not.toHaveBeenCalled(); // still waiting for the slow request

      releaseSlowRequest();
      await expect(inFlight).resolves.toBe('done');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      // Never leave the socket open if an assertion fails, or Jest hangs instead of reporting.
      releaseSlowRequest();
      server.closeAllConnections();
      server.close();
    }
  });
});
