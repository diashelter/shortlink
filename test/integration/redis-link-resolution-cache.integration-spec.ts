import Redis from 'ioredis';
import { validateEnvironment } from '../../src/environment.validation';
import { RedisLinkResolutionCache } from '../../src/modules/links/redis-link-resolution-cache.service';
import { RedisService } from '../../src/redis.service';

function createBrokenRedisService(): {
  redisService: RedisService;
  client: Redis;
} {
  const env = validateEnvironment();
  const client = new Redis({
    host: env.redis.host,
    port: 1,
    connectTimeout: 200,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  client.on('error', () => undefined);

  const redisService = {
    getClient: () => client,
    get: (key: string) => client.get(key),
    set: (key: string, value: string, ttlSeconds?: number) =>
      ttlSeconds !== undefined
        ? client.set(key, value, 'EX', ttlSeconds)
        : client.set(key, value),
    del: (key: string) => client.del(key),
    ttl: (key: string) => client.ttl(key),
  } as unknown as RedisService;

  return { redisService, client };
}

describe('RedisLinkResolutionCache (integration)', () => {
  const KEY_PREFIX = 'shortlink:links:resolution:';
  const shortCode = 'ABC123';
  const destinationUrl = 'https://example.com/path?q=1#frag';

  let redisService: RedisService;
  let cache: RedisLinkResolutionCache;
  let client: Redis;
  const testKeys: string[] = [];

  function trackKey(key: string): string {
    testKeys.push(key);
    return key;
  }

  beforeAll(() => {
    redisService = new RedisService();
    cache = new RedisLinkResolutionCache(redisService);
    client = redisService.getClient();
  });

  afterEach(async () => {
    if (testKeys.length > 0) {
      await client.del(...testKeys);
      testKeys.length = 0;
    }
  });

  afterAll(async () => {
    await redisService.onModuleDestroy();
  });

  it('sets and gets a canonical destination URL under the expected key', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await cache.set(shortCode, destinationUrl);

    expect(await cache.get(shortCode)).toBe(destinationUrl);
    expect(await client.get(key)).toBe(destinationUrl);
  });

  it('applies the configured native TTL', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);
    const ttlSeconds = validateEnvironment().linkResolutionCacheTtlSeconds;

    await cache.set(shortCode, destinationUrl);

    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ttlSeconds);
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('MISSING')).toBeNull();
  });

  it('invalidates a cached entry', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await cache.set(shortCode, destinationUrl);
    await cache.invalidate(shortCode);

    expect(await cache.get(shortCode)).toBeNull();
    expect(await client.get(key)).toBeNull();
  });

  it('propagates Redis unavailability to the caller', async () => {
    const broken = createBrokenRedisService();
    const brokenCache = new RedisLinkResolutionCache(broken.redisService);

    await expect(brokenCache.get(shortCode)).rejects.toThrow();
    await expect(brokenCache.set(shortCode, destinationUrl)).rejects.toThrow();
    await expect(brokenCache.invalidate(shortCode)).rejects.toThrow();

    broken.client.disconnect();
  });
});
