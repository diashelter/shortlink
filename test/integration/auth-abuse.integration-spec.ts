import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AuthSecurityStorageUnavailableError } from '../../src/modules/auth/auth-state.service';
import { RedisAuthStateService } from '../../src/modules/auth/redis-auth-state.service';
import { RedisService } from '../../src/redis.service';
import { validateEnvironment } from '../../src/environment.validation';

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
    eval: (script: string, numKeys: number, ...args: (string | number)[]) =>
      client.eval(script, numKeys, ...args),
    exists: (key: string) => client.exists(key),
    incr: (key: string) => client.incr(key),
    expire: (key: string, seconds: number) => client.expire(key, seconds),
  } as unknown as RedisService;

  return { redisService, client };
}

async function destroyBrokenClient(client: Redis | undefined): Promise<void> {
  if (!client) {
    return;
  }
  client.disconnect();
  await new Promise((resolve) => setImmediate(resolve));
}

function createAuthServiceWithState(state: RedisAuthStateService): AuthService {
  return new AuthService(
    {
      findAccountByEmail: jest.fn(),
    } as never,
    state,
    {
      enqueueVerificationCode: jest.fn(),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {
      record: jest.fn(),
    } as never,
  );
}

describe('AuthService abuse controls (integration)', () => {
  let brokenClient: Redis | undefined;

  afterEach(async () => {
    await destroyBrokenClient(brokenClient);
    brokenClient = undefined;
  });

  it('maps Redis unavailability on rate limits to 503 AUTH_SECURITY_STORAGE_UNAVAILABLE', async () => {
    const { redisService, client } = createBrokenRedisService();
    brokenClient = client;
    const state = new RedisAuthStateService(
      redisService,
      'integration-abuse-hmac-secret',
    );
    const service = createAuthServiceWithState(state);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    let caught: unknown;
    try {
      await service.startLogin(
        { email: 'abuse-redis@example.com', password: 'Valid1!pass' },
        '203.0.113.10',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(exception.getResponse()).toEqual(
      expect.objectContaining({
        code: 'AUTH_SECURITY_STORAGE_UNAVAILABLE',
        message: expect.any(String),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('security storage unavailable'),
    );

    const serialized = JSON.stringify({
      response: exception.getResponse(),
      logs: warnSpy.mock.calls,
    });
    expect(serialized).not.toContain('Valid1!pass');
    expect(serialized).not.toContain('abuse-redis@example.com');

    warnSpy.mockRestore();
  }, 10_000);

  it('fails closed when incrementRateLimit cannot reach Redis', async () => {
    const { redisService, client } = createBrokenRedisService();
    brokenClient = client;
    const state = new RedisAuthStateService(
      redisService,
      'integration-abuse-hmac-secret',
    );

    await expect(
      state.incrementRateLimit('login', 'email', 'dead-hash', 900),
    ).rejects.toBeInstanceOf(AuthSecurityStorageUnavailableError);
  }, 10_000);
});
