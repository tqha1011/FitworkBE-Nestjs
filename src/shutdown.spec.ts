import { createShutdown } from './shutdown';

describe('application shutdown', () => {
  afterEach(() => jest.useRealTimers());

  it('waits for application and worker cleanup before flushing, only once', async () => {
    const events: string[] = [];
    let release!: () => void;
    const closing = new Promise<void>((resolve) => (release = resolve));
    const exit = jest.fn();
    const shutdown = createShutdown(
      async () => {
        events.push('close');
        await closing;
        events.push('closed');
      },
      () => {
        events.push('flush');
        return Promise.resolve();
      },
      exit,
    );
    const first = shutdown();
    const second = shutdown();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(events).toEqual(['close']);
    release();
    await first;
    expect(events).toEqual(['close', 'closed', 'flush']);
    expect(exit.mock.calls).toEqual([[0]]);
  });

  it('still flushes when application cleanup fails', async () => {
    const flush = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    await createShutdown(
      () => Promise.reject(new Error('close failed')),
      flush,
      exit,
    )();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit.mock.calls).toEqual([[1]]);
  });

  it('exits unsuccessfully when telemetry shutdown fails', async () => {
    const exit = jest.fn();
    await createShutdown(
      () => Promise.resolve(),
      () => Promise.reject(new Error('export failed')),
      exit,
    )();
    expect(exit.mock.calls).toEqual([[1]]);
  });

  it.each(['close', 'flush'])(
    'bounds a hanging %s and ignores later signals',
    async (stage) => {
      jest.useFakeTimers();
      const exit = jest.fn();
      const hang = () => new Promise<void>(() => {});
      const done = () => Promise.resolve();
      const shutdown = createShutdown(
        stage === 'close' ? hang : done,
        stage === 'flush' ? hang : done,
        exit,
        100,
      );
      const first = shutdown();
      await jest.advanceTimersByTimeAsync(100);
      expect(exit.mock.calls).toEqual([[1]]);
      expect(shutdown()).toBe(first);
    },
  );
});
