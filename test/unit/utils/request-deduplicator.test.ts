import { RequestDeduplicator } from '../../../src/utils/request-deduplicator';

describe('RequestDeduplicator', () => {
  it('shares one in-flight promise per key', async () => {
    const deduplicator = new RequestDeduplicator<number>();
    const work = jest.fn(() => Promise.resolve(42));

    const results = await Promise.all([
      deduplicator.run('a', work),
      deduplicator.run('a', work),
      deduplicator.run('a', work),
    ]);

    expect(results).toEqual([42, 42, 42]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('runs different keys independently', async () => {
    const deduplicator = new RequestDeduplicator<string>();

    await expect(
      Promise.all([
        deduplicator.run('a', () => Promise.resolve('A')),
        deduplicator.run('b', () => Promise.resolve('B')),
      ]),
    ).resolves.toEqual(['A', 'B']);
  });

  it('forgets a key once settled (success or failure), so the next call runs again', async () => {
    const deduplicator = new RequestDeduplicator<number>();
    await expect(deduplicator.run('a', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(deduplicator.size).toBe(0);

    await expect(deduplicator.run('a', () => Promise.resolve(1))).resolves.toBe(1);
  });

  it('shares failures with every waiter', async () => {
    const deduplicator = new RequestDeduplicator<number>();
    const failing = () => Promise.reject(new Error('down'));

    const results = await Promise.allSettled([
      deduplicator.run('a', failing),
      deduplicator.run('a', failing),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('drain waits for everything in flight and never throws', async () => {
    const deduplicator = new RequestDeduplicator<number>();
    let finished = false;
    void deduplicator
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
    void deduplicator.run('b', () => Promise.reject(new Error('x'))).catch(() => undefined);

    await deduplicator.drain();

    expect(finished).toBe(true);
  });
});
