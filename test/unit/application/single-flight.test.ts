import { SingleFlight } from '../../../src/application/single-flight';

describe('SingleFlight', () => {
  it('shares one in-flight promise per key', async () => {
    const flights = new SingleFlight<number>();
    const work = jest.fn(() => Promise.resolve(42));

    const results = await Promise.all([
      flights.run('a', work),
      flights.run('a', work),
      flights.run('a', work),
    ]);

    expect(results).toEqual([42, 42, 42]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs different keys independently', async () => {
    const flights = new SingleFlight<string>();

    await expect(
      Promise.all([
        flights.run('a', () => Promise.resolve('A')),
        flights.run('b', () => Promise.resolve('B')),
      ]),
    ).resolves.toEqual(['A', 'B']);
  });

  it('forgets a key once settled (success or failure), so the next call runs again', async () => {
    const flights = new SingleFlight<number>();
    await expect(flights.run('a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(flights.size).toBe(0);

    await expect(flights.run('a', () => Promise.resolve(1))).resolves.toBe(1);
  });

  it('shares failures with every waiter', async () => {
    const flights = new SingleFlight<number>();
    const failing = () => Promise.reject(new Error('down'));

    const results = await Promise.allSettled([
      flights.run('a', failing),
      flights.run('a', failing),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('drain waits for everything in flight and never throws', async () => {
    const flights = new SingleFlight<number>();
    let finished = false;
    void flights
      .run(
        'a',
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              resolve(1);
            }, 20),
          ),
      )
      .then(() => (finished = true));
    void flights.run('b', () => Promise.reject(new Error('x'))).catch(() => undefined);

    await flights.drain();

    expect(finished).toBe(true);
  });
});
