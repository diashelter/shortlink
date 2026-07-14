import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, QueryFailedError } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { SessionRevocationReason } from '../../src/modules/auth/auth.types';
import { TypeormAuthRepository } from '../../src/modules/auth/typeorm-auth.repository';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('TypeormAuthRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: AuthRepository;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions());
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'each' });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
    repository = new TypeormAuthRepository(dataSource);
  });

  it('exposes AuthRepository without TypeORM imports in the interface module', () => {
    const interfaceSource = readFileSync(
      join(__dirname, '../../src/modules/auth/auth.repository.ts'),
      'utf8',
    );

    expect(interfaceSource).not.toMatch(/from ['"]typeorm['"]/);
    expect(interfaceSource).not.toMatch(/\.entity['"]/);
    expect(repository).toBeInstanceOf(TypeormAuthRepository);
    expect(repository).toBeInstanceOf(AuthRepository);
  });

  it('creates pending accounts and enforces unique canonical email', async () => {
    const account = await repository.createPendingAccount({
      email: 'user@example.com',
      passwordHash: BCRYPT_HASH,
    });

    expect(account.status).toBe(AccountStatus.PENDING);
    expect(account.email).toBe('user@example.com');

    await expect(
      repository.createPendingAccount({
        email: 'user@example.com',
        passwordHash: BCRYPT_HASH,
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);

    const found = await repository.findAccountByEmail('user@example.com');
    expect(found?.id).toBe(account.id);
  });

  it('keeps only the last exclusive session active under concurrent creation', async () => {
    const account = await repository.createPendingAccount({
      email: 'concurrent@example.com',
      passwordHash: BCRYPT_HASH,
    });
    await repository.activateAccount(account.id);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [first, second] = await Promise.all([
      repository.createExclusiveSession(account.id, {
        refreshTokenHash: 'refresh-hash-a',
        csrfTokenHash: 'csrf-hash-a',
        expiresAt,
      }),
      repository.createExclusiveSession(account.id, {
        refreshTokenHash: 'refresh-hash-b',
        csrfTokenHash: 'csrf-hash-b',
        expiresAt,
      }),
    ]);

    expect(first.session.id).not.toBe(second.session.id);

    const sessions = (await dataSource.query(
      'SELECT id, "revokedAt", "revocationReason", "refreshTokenHash" FROM "auth_sessions" WHERE "userId" = $1 ORDER BY "createdAt" ASC',
      [account.id],
    )) as Array<{
      id: string;
      revokedAt: Date | null;
      revocationReason: string | null;
      refreshTokenHash: string;
    }>;

    expect(sessions).toHaveLength(2);

    const active = sessions.filter((session) => session.revokedAt === null);
    const revoked = sessions.filter((session) => session.revokedAt !== null);

    expect(active).toHaveLength(1);
    expect(revoked).toHaveLength(1);
    expect(revoked[0].revocationReason).toBe(SessionRevocationReason.NEW_LOGIN);

    const activeIds = new Set([first.session.id, second.session.id]);
    expect(activeIds.has(active[0].id)).toBe(true);

    const historyCount = (await dataSource.query(
      'SELECT COUNT(*)::text AS count FROM "session_refresh_tokens"',
    )) as Array<{ count: string }>;
    expect(Number(historyCount[0].count)).toBe(2);

    const activeByHash = await repository.findSessionByRefreshTokenHash(
      active[0].refreshTokenHash,
    );
    expect(activeByHash?.id).toBe(active[0].id);
    expect(activeByHash?.revokedAt).toBeNull();
  });

  it('revokes all sessions and rotates refresh tokens under account lock', async () => {
    const account = await repository.createPendingAccount({
      email: 'rotate@example.com',
      passwordHash: BCRYPT_HASH,
    });
    await repository.activateAccount(account.id);

    const expiresAt = new Date(Date.now() + 60_000);
    const created = await repository.createExclusiveSession(account.id, {
      refreshTokenHash: 'refresh-current',
      csrfTokenHash: 'csrf-1',
      expiresAt,
    });

    const rotated = await repository.rotateRefreshToken(created.session.id, {
      currentTokenHash: 'refresh-current',
      newTokenHash: 'refresh-next',
      newExpiresAt: new Date(Date.now() + 120_000),
    });

    expect(rotated.session.refreshTokenHash).toBe('refresh-next');
    expect(rotated.refreshToken.tokenHash).toBe('refresh-next');
    expect(rotated.refreshToken.usedAt).toBeNull();

    const previous =
      await repository.findRefreshTokenHistoryByHash('refresh-current');
    expect(previous?.usedAt).not.toBeNull();

    await repository.revokeAllSessions(
      account.id,
      SessionRevocationReason.PASSWORD_RESET,
    );

    const sessions = (await dataSource.query(
      'SELECT "revokedAt" FROM "auth_sessions" WHERE "userId" = $1',
      [account.id],
    )) as Array<{ revokedAt: Date | null }>;
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });
});
