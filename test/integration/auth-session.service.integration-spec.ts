import { readFileSync } from 'fs';
import { join } from 'path';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { validateEnvironment } from '../../src/environment.validation';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AuthSessionService } from '../../src/modules/auth/auth-session.service';
import { SessionRevocationReason } from '../../src/modules/auth/auth.types';
import { NodeAuthCryptoService } from '../../src/modules/auth/node-auth-crypto.service';
import { RedisAuthStateService } from '../../src/modules/auth/redis-auth-state.service';
import { TypeormAuthRepository } from '../../src/modules/auth/typeorm-auth.repository';
import { RedisService } from '../../src/redis.service';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('AuthSessionService (integration)', () => {
  let dataSource: DataSource;
  let redisService: RedisService;
  let service: AuthSessionService;
  let crypto: NodeAuthCryptoService;
  let state: RedisAuthStateService;
  let repository: TypeormAuthRepository;

  beforeAll(async () => {
    const env = validateEnvironment();
    dataSource = new DataSource(buildDataSourceOptions());
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'each' });

    redisService = new RedisService();
    state = new RedisAuthStateService(redisService);
    repository = new TypeormAuthRepository(dataSource);
    crypto = new NodeAuthCryptoService(
      env.authHmacSecret,
      env.authTokenHashSecret,
      env.jwtAccessSecret,
    );
    service = new AuthSessionService(repository, state, crypto);
  });

  afterAll(async () => {
    await redisService.onModuleDestroy();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
    const keys = await redisService
      .getClient()
      .keys('shortlink:auth:session:*');
    if (keys.length > 0) {
      await redisService.getClient().del(...keys);
    }
  });

  it('keeps AuthCryptoService free of Nest JWT module imports', () => {
    const source = readFileSync(
      join(__dirname, '../../src/modules/auth/auth-crypto.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@nestjs\/jwt/);
    expect(source).not.toMatch(/jsonwebtoken/);
  });

  async function createActiveAccount(email: string) {
    const account = await repository.createPendingAccount({
      email,
      passwordHash: BCRYPT_HASH,
    });
    return repository.activateAccount(account.id);
  }

  it('creates a session, hits cache, and validates the JWT claims shape', async () => {
    const account = await createActiveAccount('session-cache@example.com');

    const issued = await service.createSessionAfterLogin(
      account.id,
      AccountRole.USER,
    );

    const cached = await state.getSessionCache(issued.sessionId);
    expect(cached?.active).toBe(true);
    expect(cached?.userId).toBe(account.id);

    const principal = await service.validateSession(issued.sessionId);
    expect(principal).toEqual({
      userId: account.id,
      role: AccountRole.USER,
      sessionId: issued.sessionId,
    });

    const payload = crypto.verifyAccessToken(issued.accessToken);
    expect(payload.sub).toBe(account.id);
    expect(payload.role).toBe(AccountRole.USER);
    expect(payload.sessionId).toBe(issued.sessionId);
    expect(payload.exp - payload.iat).toBe(15 * 60);
    expect(issued.expiresIn).toBe(15 * 60);
  });

  it('validates via PostgreSQL and repopulates cache after a cache delete', async () => {
    const account = await createActiveAccount('session-fallback@example.com');
    const issued = await service.createSessionAfterLogin(
      account.id,
      AccountRole.USER,
    );

    await state.deleteSessionCache(issued.sessionId);
    await expect(state.getSessionCache(issued.sessionId)).resolves.toBeNull();

    const principal = await service.validateSession(issued.sessionId);
    expect(principal?.sessionId).toBe(issued.sessionId);

    const repopulated = await state.getSessionCache(issued.sessionId);
    expect(repopulated?.active).toBe(true);
    expect(repopulated?.userId).toBe(account.id);
  });

  it('validates sessions via PostgreSQL when Redis is unavailable', async () => {
    const account = await createActiveAccount('session-redis-down@example.com');
    const issued = await service.createSessionAfterLogin(
      account.id,
      AccountRole.USER,
    );

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
      eval: (script: string, numKeys: number, ...args: (string | number)[]) =>
        unreachable.eval(script, numKeys, ...args),
      exists: (key: string) => unreachable.exists(key),
      incr: (key: string) => unreachable.incr(key),
      expire: (key: string, seconds: number) =>
        unreachable.expire(key, seconds),
    } as unknown as RedisService;

    const brokenState = new RedisAuthStateService(
      brokenRedis,
      'integration-session-fallback-hmac',
    );
    const serviceWithBrokenRedis = new AuthSessionService(
      repository,
      brokenState,
      crypto,
    );

    const principal = await serviceWithBrokenRedis.validateSession(
      issued.sessionId,
    );
    expect(principal).toEqual({
      userId: account.id,
      role: AccountRole.USER,
      sessionId: issued.sessionId,
    });

    unreachable.disconnect();
  }, 10_000);

  it('rotates refresh tokens and rejects immediate reuse by revoking the session', async () => {
    const account = await createActiveAccount('session-refresh@example.com');
    const issued = await service.createSessionAfterLogin(
      account.id,
      AccountRole.USER,
    );

    const rotated = await service.refresh(issued.refreshToken);
    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(rotated.sessionId).toBe(issued.sessionId);

    const payload = crypto.verifyAccessToken(rotated.accessToken);
    expect(payload.sessionId).toBe(issued.sessionId);

    await expect(service.refresh(issued.refreshToken)).rejects.toThrow();

    const sessionRows = (await dataSource.query(
      'SELECT "revokedAt", "revocationReason" FROM "auth_sessions" WHERE id = $1',
      [issued.sessionId],
    )) as Array<{ revokedAt: Date | null; revocationReason: string | null }>;

    expect(sessionRows[0].revokedAt).not.toBeNull();
    expect(sessionRows[0].revocationReason).toBe(
      SessionRevocationReason.REFRESH_REUSE,
    );
    await expect(state.getSessionCache(issued.sessionId)).resolves.toBeNull();
    await expect(service.validateSession(issued.sessionId)).resolves.toBeNull();
  });

  it('rejects JWT validation immediately after logout revocation', async () => {
    const account = await createActiveAccount('session-logout@example.com');
    const issued = await service.createSessionAfterLogin(
      account.id,
      AccountRole.USER,
    );

    await expect(
      service.validateSession(issued.sessionId),
    ).resolves.not.toBeNull();

    await service.logout(issued.refreshToken);

    await expect(state.getSessionCache(issued.sessionId)).resolves.toBeNull();
    await expect(service.validateSession(issued.sessionId)).resolves.toBeNull();

    const active = await repository.findActiveSessionById(issued.sessionId);
    expect(active).toBeNull();
  });
});
