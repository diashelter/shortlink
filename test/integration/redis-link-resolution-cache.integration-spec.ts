import Redis from 'ioredis';
import { validateEnvironment } from '../../src/environment.validation';
import { RedisLinkResolutionCache } from '../../src/modules/links/redis-link-resolution-cache.service';
import { ResolvedLink } from '../../src/modules/links/links.types';
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
  const KEY_PREFIX = 'shortlink:links:resolution:v2:';
  const LEGACY_KEY_PREFIX = 'shortlink:links:resolution:';
  const shortCode = 'ABC123';
  const destinationUrl = 'https://example.com/path?q=1#frag';
  const resolved: ResolvedLink = {
    linkId: '33333333-3333-4333-8333-333333333333',
    destinationUrl,
  };

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

  it('sets and gets a ResolvedLink under the v2 key', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await cache.set(shortCode, resolved);

    expect(await cache.get(shortCode)).toEqual(resolved);
    expect(await client.get(key)).toBe(JSON.stringify(resolved));
  });

  it('applies the configured native TTL', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);
    const ttlSeconds = validateEnvironment().linkResolutionCacheTtlSeconds;

    await cache.set(shortCode, resolved);

    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ttlSeconds);
  });

  it('returns null for a missing key', async () => {
    expect(await cache.get('MISSING')).toBeNull();
  });

  it('invalidates a cached entry', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await cache.set(shortCode, resolved);
    await cache.invalidate(shortCode);

    expect(await cache.get(shortCode)).toBeNull();
    expect(await client.get(key)).toBeNull();
  });

  it('propagates Redis unavailability to the caller', async () => {
    const broken = createBrokenRedisService();
    const brokenCache = new RedisLinkResolutionCache(broken.redisService);

    await expect(brokenCache.get(shortCode)).rejects.toThrow();
    await expect(brokenCache.set(shortCode, resolved)).rejects.toThrow();
    await expect(brokenCache.invalidate(shortCode)).rejects.toThrow();

    broken.client.disconnect();
  });

  it('stores serialized ResolvedLink JSON under the versioned key', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await cache.set(shortCode, resolved);

    expect(key).toBe(`shortlink:links:resolution:v2:${shortCode}`);
    expect(JSON.parse((await client.get(key)) as string)).toEqual(resolved);
  });

  it('does not interpret legacy v1 string-only cache entries', async () => {
    const legacyKey = trackKey(`${LEGACY_KEY_PREFIX}${shortCode}`);
    const v2Key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await client.set(legacyKey, destinationUrl);

    expect(await cache.get(shortCode)).toBeNull();
    expect(await client.get(legacyKey)).toBe(destinationUrl);
    expect(await client.get(v2Key)).toBeNull();
  });

  it('returns null for a plain string stored under the v2 key', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await client.set(key, destinationUrl);

    expect(await cache.get(shortCode)).toBeNull();
  });

  it('returns null for malformed JSON under the v2 key', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await client.set(key, '{"linkId":');

    expect(await cache.get(shortCode)).toBeNull();
  });

  it('returns null when v2 JSON is missing required ResolvedLink fields', async () => {
    const key = trackKey(`${KEY_PREFIX}${shortCode}`);

    await client.set(key, JSON.stringify({ destinationUrl }));

    expect(await cache.get(shortCode)).toBeNull();
  });
});
