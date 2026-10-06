import { EventEmitter } from 'node:events';
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLogger } from '../../../src/observability/logger';
import {
  createShutdownController,
  registerProcessHandlers,
  type Closable,
  type ShutdownController,
} from '../../../src/shared/process/graceful-shutdown';

const logger = createLogger({ level: 'silent' });

/** A fake server whose close() outcome each test controls. */
function fakeServer(
  closeBehaviour: (cb: (err?: Error) => void) => void = (cb) => {
    cb();
  },
) {
  const server = {
    close: jest.fn(closeBehaviour),
    closeIdleConnections: jest.fn(),
  };
  return server as typeof server & Server;
}

function resource(name: string, calls: string[], fail = false): Closable {
  return {
    name,
    close: () => {
      calls.push(name);
      return fail ? Promise.reject(new Error(`${name} failed`)) : Promise.resolve();
    },
  };
}

describe('createShutdownController', () => {
  it('closes the server, then resources in reverse order, then exits 0', async () => {
    const calls: string[] = [];
    const server = fakeServer((cb) => {
      calls.push('server');
      cb();
    });
    const exit = jest.fn();
    const controller = createShutdownController({
      server,
      logger,
      exit,
      resources: [resource('db', calls), resource('cache', calls)],
    });

    await controller.shutdown('SIGTERM');

    expect(calls).toEqual(['server', 'cache', 'db']);
    expect(server.closeIdleConnections).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('is idempotent: concurrent calls share one shutdown', async () => {
    const server = fakeServer();
    const exit = jest.fn();
    const controller = createShutdownController({ server, logger, exit });

    expect(controller.isShuttingDown()).toBe(false);
    const first = controller.shutdown('SIGTERM');
    const second = controller.shutdown('SIGINT');
    expect(controller.isShuttingDown()).toBe(true);
    await Promise.all([first, second]);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('keeps closing other resources when one fails, and exits 1', async () => {
    const calls: string[] = [];
    const exit = jest.fn();
    const controller = createShutdownController({
      server: fakeServer(),
      logger,
      exit,
      resources: [resource('db', calls), resource('broken', calls, true)],
    });

    await controller.shutdown('SIGTERM');

    expect(calls).toEqual(['broken', 'db']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 if the server fails to close, but still releases resources', async () => {
    const calls: string[] = [];
    const exit = jest.fn();
    const controller = createShutdownController({
      server: fakeServer((cb) => {
        cb(new Error('close failed'));
      }),
      logger,
      exit,
      resources: [resource('db', calls)],
    });

    await controller.shutdown('SIGTERM');

    expect(calls).toEqual(['db']);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('treats an already-stopped server as closed', async () => {
    const notRunning = Object.assign(new Error('not running'), { code: 'ERR_SERVER_NOT_RUNNING' });
    const exit = jest.fn();
    const controller = createShutdownController({
      server: fakeServer((cb) => {
        cb(notRunning);
      }),
      logger,
      exit,
    });

    await controller.shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('honours the requested exit code (e.g. 1 after a crash)', async () => {
    const exit = jest.fn();
    const controller = createShutdownController({ server: fakeServer(), logger, exit });

    await controller.shutdown('uncaughtException', 1);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when draining exceeds the timeout', () => {
    jest.useFakeTimers();
    try {
      const exit = jest.fn();
      const controller = createShutdownController({
        server: fakeServer(() => undefined), // close() never completes: a stuck connection
        logger,
        exit,
        timeoutMs: 5_000,
      });

      void controller.shutdown('SIGTERM');
      jest.advanceTimersByTime(4_999);
      expect(exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets an in-flight request finish while refusing new connections (real server)', async () => {
    let releaseSlowRequest: () => void = () => undefined;
    const server = http.createServer((_req, res) => {
      releaseSlowRequest = () => res.end('done');
    });
    // Pin to IPv4: on dual-stack hosts "localhost" tries ::1 and 127.0.0.1, and a refusal then
    // surfaces as an AggregateError with an empty message.
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

    try {
      const inFlight = get();
      await new Promise((resolve) => setTimeout(resolve, 50)); // request reaches the handler

      const exit = jest.fn();
      const shutdownDone = createShutdownController({ server, logger, exit }).shutdown('SIGTERM');

      await expect(get()).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      expect(exit).not.toHaveBeenCalled(); // still draining

      releaseSlowRequest();
      await expect(inFlight).resolves.toBe('done');
      await shutdownDone;
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      // Never leave the socket open if an assertion fails, or Jest hangs instead of reporting.
      releaseSlowRequest();
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('registerProcessHandlers', () => {
  function setup(shuttingDown = false) {
    const proc = new EventEmitter();
    const exit = jest.fn();
    const controller: jest.Mocked<ShutdownController> = {
      shutdown: jest.fn().mockResolvedValue(undefined),
      isShuttingDown: jest.fn().mockReturnValue(shuttingDown),
    };
    const fatal = jest.spyOn(logger, 'fatal');
    registerProcessHandlers(controller, logger, proc, exit);
    return { proc, exit, controller, fatal };
  }

  afterEach(() => jest.restoreAllMocks());

  it.each(['SIGTERM', 'SIGINT'])('starts a graceful shutdown (exit 0) on %s', (signal) => {
    const { proc, controller, exit } = setup();

    proc.emit(signal, signal);

    expect(controller.shutdown).toHaveBeenCalledWith(signal, 0);
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits immediately with 1 on a second signal during shutdown', () => {
    const { proc, controller, exit } = setup(true);

    proc.emit('SIGINT', 'SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
    expect(controller.shutdown).not.toHaveBeenCalled();
  });

  it('logs an unhandled rejection at fatal and shuts down with exit code 1', () => {
    const { proc, controller, fatal } = setup();
    const reason = new Error('forgot to await');

    proc.emit('unhandledRejection', reason);

    expect(fatal).toHaveBeenCalledWith({ err: reason }, 'Unhandled promise rejection');
    expect(controller.shutdown).toHaveBeenCalledWith('unhandledRejection', 1);
  });

  it('logs an uncaught exception at fatal and shuts down with exit code 1', () => {
    const { proc, controller, fatal } = setup();
    const err = new TypeError('x is undefined');

    proc.emit('uncaughtException', err);

    expect(fatal).toHaveBeenCalledWith({ err }, 'Uncaught exception');
    expect(controller.shutdown).toHaveBeenCalledWith('uncaughtException', 1);
  });
});
