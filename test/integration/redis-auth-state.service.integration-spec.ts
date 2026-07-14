import { createHash, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { validateEnvironment } from '../../src/environment.validation';
import {
  AuthIssuancePurpose,
  AuthSecurityStorageUnavailableError,
  AuthStateService,
} from '../../src/modules/auth/auth-state.service';
import { RedisAuthStateService } from '../../src/modules/auth/redis-auth-state.service';
import { RedisService } from '../../src/redis.service';

const KEY_PREFIX = 'shortlink:auth:';

describe('RedisAuthStateService (integration)', () => {
  let redisService: RedisService;
  let service: AuthStateService;
  let client: Redis;
  const testKeys: string[] = [];

  function trackKey(key: string): string {
    testKeys.push(key);
    return key;
  }

  beforeAll(() => {
    redisService = new RedisService();
    service = new RedisAuthStateService(redisService);
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

  it('exposes AuthStateService without ioredis types in the interface module', () => {
    const interfaceSource = readFileSync(
      join(__dirname, '../../src/modules/auth/auth-state.service.ts'),
      'utf8',
    );

    expect(interfaceSource).not.toMatch(/from ['"]ioredis['"]/);
    expect(interfaceSource).not.toMatch(/RedisService/);
    expect(service).toBeInstanceOf(RedisAuthStateService);
    expect(service).toBeInstanceOf(AuthStateService);
  });

  it('stores activation codes as HMAC only and sets native TTL', async () => {
    const userId = randomUUID();
    const code = '123456';
    const key = trackKey(`${KEY_PREFIX}verification:activation:${userId}`);

    await service.setActivationCode(
      userId,
      code,
      new Date(Date.now() + 60_000),
    );

    const raw = await client.get(key);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(code);

    const payload = JSON.parse(raw!) as { codeHmac: string; attempts: number };
    expect(payload.codeHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.attempts).toBe(0);

    const ttl = await client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);

    const consumed = await service.consumeActivationCode(userId, code);
    expect(consumed).toEqual({ status: 'consumed' });
    await expect(client.get(key)).resolves.toBeNull();
  });

  it('rejects a second consume of the same activation code', async () => {
    const userId = randomUUID();
    const code = '654321';
    trackKey(`${KEY_PREFIX}verification:activation:${userId}`);

    await service.setActivationCode(
      userId,
      code,
      new Date(Date.now() + 60_000),
    );

    await expect(service.consumeActivationCode(userId, code)).resolves.toEqual(
      { status: 'consumed' },
    );
    await expect(service.consumeActivationCode(userId, code)).resolves.toEqual(
      { status: 'missing' },
    );
  });

  it('allows only one concurrent activation consume to win', async () => {
    const userId = randomUUID();
    const code = '111222';
    trackKey(`${KEY_PREFIX}verification:activation:${userId}`);

    await service.setActivationCode(
      userId,
      code,
      new Date(Date.now() + 60_000),
    );

    const results = await Promise.all([
      service.consumeActivationCode(userId, code),
      service.consumeActivationCode(userId, code),
      service.consumeActivationCode(userId, code),
      service.consumeActivationCode(userId, code),
    ]);

    const consumed = results.filter((r) => r.status === 'consumed');
    const missing = results.filter((r) => r.status === 'missing');
    expect(consumed).toHaveLength(1);
    expect(missing).toHaveLength(3);
  });

  it('ignores stale issuanceIds after a newer setIssuance', async () => {
    const userId = randomUUID();
    const staleId = randomUUID();
    const currentId = randomUUID();
    trackKey(`${KEY_PREFIX}verification-issuance:activation:${userId}`);

    await service.setIssuance(AuthIssuancePurpose.ACTIVATION, userId, staleId);
    await service.setIssuance(
      AuthIssuancePurpose.ACTIVATION,
      userId,
      currentId,
    );

    await expect(
      service.isCurrentIssuance(
        AuthIssuancePurpose.ACTIVATION,
        userId,
        staleId,
      ),
    ).resolves.toBe(false);
    await expect(
      service.isCurrentIssuance(
        AuthIssuancePurpose.ACTIVATION,
        userId,
        currentId,
      ),
    ).resolves.toBe(true);

    const ttl = await client.ttl(
      `${KEY_PREFIX}verification-issuance:activation:${userId}`,
    );
    expect(ttl).toBeGreaterThan(0);
  });

  it('creates and single-uses a login challenge with TTL', async () => {
    const userId = randomUUID();
    const challengeId = randomUUID();
    const code = '998877';
    trackKey(`${KEY_PREFIX}login-challenge:${challengeId}`);
    trackKey(`${KEY_PREFIX}login-challenge:account:${userId}`);

    await service.createLoginChallenge(
      userId,
      challengeId,
      code,
      new Date(Date.now() + 3_600_000),
    );

    const challengeTtl = await client.ttl(
      `${KEY_PREFIX}login-challenge:${challengeId}`,
    );
    expect(challengeTtl).toBeGreaterThan(0);

    const raw = await client.get(
      `${KEY_PREFIX}login-challenge:${challengeId}`,
    );
    expect(raw).not.toContain(code);

    const first = await service.consumeLoginChallenge(challengeId, code);
    expect(first).toEqual({ status: 'consumed', userId });

    const second = await service.consumeLoginChallenge(challengeId, code);
    expect(second).toEqual({ status: 'missing' });
  });

  it('locks login after five failed attempts', async () => {
    const userId = randomUUID();
    trackKey(`${KEY_PREFIX}failed-login:${userId}`);
    trackKey(`${KEY_PREFIX}login-lock:${userId}`);

    for (let i = 1; i <= 4; i++) {
      const result = await service.incrementFailedLogin(userId);
      expect(result.failures).toBe(i);
      expect(result.locked).toBe(false);
      await expect(service.isLoginLocked(userId)).resolves.toBe(false);
    }

    const fifth = await service.incrementFailedLogin(userId);
    expect(fifth).toEqual({ failures: 5, locked: true });
    await expect(service.isLoginLocked(userId)).resolves.toBe(true);

    const lockTtl = await client.ttl(`${KEY_PREFIX}login-lock:${userId}`);
    expect(lockTtl).toBeGreaterThan(0);
    expect(lockTtl).toBeLessThanOrEqual(3600);
  });

  it('increments rate limits with TTL and enforces cooldown markers', async () => {
    const emailHash = createHash('sha256').update(randomUUID()).digest('hex');
    const userId = randomUUID();
    const rateKey = trackKey(
      `${KEY_PREFIX}rate:register:email:${emailHash}`,
    );
    trackKey(`${KEY_PREFIX}resend:activation:${userId}`);

    const first = await service.incrementRateLimit(
      'register',
      'email',
      emailHash,
      3600,
    );
    const second = await service.incrementRateLimit(
      'register',
      'email',
      emailHash,
      3600,
    );
    expect(first).toBe(1);
    expect(second).toBe(2);

    const rateTtl = await client.ttl(rateKey);
    expect(rateTtl).toBeGreaterThan(0);

    await expect(
      service.isResendCooldownActive('activation', userId),
    ).resolves.toBe(false);

    await service.setResendCooldown('activation', userId);
    await expect(
      service.isResendCooldownActive('activation', userId),
    ).resolves.toBe(true);

    const cooldownTtl = await client.ttl(
      `${KEY_PREFIX}resend:activation:${userId}`,
    );
    expect(cooldownTtl).toBeGreaterThan(0);
    expect(cooldownTtl).toBeLessThanOrEqual(60);
  });

  it('caches session state without refresh or CSRF secrets', async () => {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 3_600_000);
    trackKey(`${KEY_PREFIX}session:${sessionId}`);

    await service.setSessionCache({
      sessionId,
      userId: randomUUID(),
      role: 'USER',
      expiresAt,
      active: true,
    });

    const cached = await service.getSessionCache(sessionId);
    expect(cached).not.toBeNull();
    expect(cached?.sessionId).toBe(sessionId);
    expect(cached?.active).toBe(true);
    expect(cached?.role).toBe('USER');

    const raw = await client.get(`${KEY_PREFIX}session:${sessionId}`);
    expect(raw).not.toMatch(/refresh|csrf/i);

    const ttl = await client.ttl(`${KEY_PREFIX}session:${sessionId}`);
    expect(ttl).toBeGreaterThan(0);

    await service.deleteSessionCache(sessionId);
    await expect(service.getSessionCache(sessionId)).resolves.toBeNull();
  });

  it('fails closed with a typed error when Redis is unavailable', async () => {
    const env = validateEnvironment();
    const unreachable = new Redis({
      host: env.redis.host,
      port: 1,
      connectTimeout: 200,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    unreachable.on('error', () => undefined);

    const brokenRedis = {
      getClient: () => unreachable,
      get: (key: string) => unreachable.get(key),
      set: (key: string, value: string, ttlSeconds?: number) =>
        ttlSeconds !== undefined
          ? unreachable.set(key, value, 'EX', ttlSeconds)
          : unreachable.set(key, value),
      del: (key: string) => unreachable.del(key),
      ttl: (key: string) => unreachable.ttl(key),
      eval: (
        script: string,
        numKeys: number,
        ...args: (string | number)[]
      ) => unreachable.eval(script, numKeys, ...args),
      exists: (key: string) => unreachable.exists(key),
      incr: (key: string) => unreachable.incr(key),
      expire: (key: string, seconds: number) => unreachable.expire(key, seconds),
    } as unknown as RedisService;

    const broken = new RedisAuthStateService(
      brokenRedis,
      'integration-fail-closed-hmac-secret',
    );

    await expect(service.isLoginLocked(randomUUID())).resolves.toBe(false);

    await expect(broken.isLoginLocked(randomUUID())).rejects.toBeInstanceOf(
      AuthSecurityStorageUnavailableError,
    );

    await expect(broken.incrementRateLimit('login', 'ip', 'abc', 900)).rejects.toBeInstanceOf(
      AuthSecurityStorageUnavailableError,
    );

    unreachable.disconnect();
  }, 10_000);
});
