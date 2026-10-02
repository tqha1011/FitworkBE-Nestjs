import { metrics } from '@opentelemetry/api';
import { RedisApplicationCache } from './redis-application-cache';

jest.mock('@nestjs/cache-manager', () => ({ CACHE_MANAGER: 'CACHE_MANAGER' }));

describe('RedisApplicationCache telemetry', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts hits and misses by fixed cache group without using IDs', async () => {
    const add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn().mockReturnValue({ add }),
    } as never);
    const cache = new RedisApplicationCache({
      get: jest
        .fn()
        .mockResolvedValueOnce('value')
        .mockResolvedValueOnce(undefined),
    } as never);

    await cache.get('applicant:private-id:evaluation-id');
    await cache.get('reference-data:skills:v1');

    expect(add).toHaveBeenCalledWith(1, {
      cache_group: 'applicant',
      result: 'hit',
    });
    expect(add).toHaveBeenCalledWith(1, {
      cache_group: 'reference_skills',
      result: 'miss',
    });
    expect(JSON.stringify(add.mock.calls)).not.toContain('private-id');
  });
});
