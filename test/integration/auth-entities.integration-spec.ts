import { execFileSync } from 'child_process';
import { DataSource, QueryFailedError } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { AuthSessionEntity } from '../../src/modules/auth/auth-session.entity';
import { SessionRefreshTokenEntity } from '../../src/modules/auth/session-refresh-token.entity';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('Auth entities and migration (integration)', () => {
  let dataSource: DataSource;

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
  });

  it('enforces unique canonical email on users', async () => {
    const accounts = dataSource.getRepository(AccountEntity);

    await accounts.save(
      accounts.create({
        email: 'user@example.com',
        status: AccountStatus.PENDING,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );

    await expect(
      accounts.save(
        accounts.create({
          email: 'user@example.com',
          status: AccountStatus.ACTIVE,
          role: AccountRole.USER,
          passwordHash: BCRYPT_HASH,
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('persists session with refresh token history', async () => {
    const accounts = dataSource.getRepository(AccountEntity);
    const sessions = dataSource.getRepository(AuthSessionEntity);
    const refreshTokens = dataSource.getRepository(SessionRefreshTokenEntity);

    const account = await accounts.save(
      accounts.create({
        email: 'session@example.com',
        status: AccountStatus.ACTIVE,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const session = await sessions.save(
      sessions.create({
        userId: account.id,
        refreshTokenHash: 'current-refresh-hash',
        csrfTokenHash: 'csrf-hash',
        expiresAt,
        revokedAt: null,
        revocationReason: null,
        lastRotatedAt: now,
      }),
    );

    await refreshTokens.save([
      refreshTokens.create({
        sessionId: session.id,
        tokenHash: 'refresh-hash-1',
        issuedAt: now,
        usedAt: now,
        expiresAt,
      }),
      refreshTokens.create({
        sessionId: session.id,
        tokenHash: 'refresh-hash-2',
        issuedAt: now,
        usedAt: null,
        expiresAt,
      }),
    ]);

    const history = await refreshTokens.find({
      where: { sessionId: session.id },
      order: { tokenHash: 'ASC' },
    });

    expect(history).toHaveLength(2);
    expect(history.map((token) => token.tokenHash)).toEqual([
      'refresh-hash-1',
      'refresh-hash-2',
    ]);
    expect(history[0].usedAt).not.toBeNull();
    expect(history[1].usedAt).toBeNull();
  });

  it('rejects duplicate refresh token hashes across the family history', async () => {
    const accounts = dataSource.getRepository(AccountEntity);
    const sessions = dataSource.getRepository(AuthSessionEntity);
    const refreshTokens = dataSource.getRepository(SessionRefreshTokenEntity);

    const account = await accounts.save(
      accounts.create({
        email: 'reuse@example.com',
        status: AccountStatus.ACTIVE,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);

    const session = await sessions.save(
      sessions.create({
        userId: account.id,
        refreshTokenHash: 'live-hash',
        csrfTokenHash: 'csrf-hash',
        expiresAt,
        revokedAt: null,
        revocationReason: null,
        lastRotatedAt: now,
      }),
    );

    await refreshTokens.save(
      refreshTokens.create({
        sessionId: session.id,
        tokenHash: 'same-hash',
        issuedAt: now,
        usedAt: null,
        expiresAt,
      }),
    );

    await expect(
      refreshTokens.save(
        refreshTokens.create({
          sessionId: session.id,
          tokenHash: 'same-hash',
          issuedAt: now,
          usedAt: null,
          expiresAt,
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('applies and reverts the auth migration through the TypeORM CLI', () => {
    const revertOutput = execFileSync('npm', ['run', 'migration:revert'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(revertOutput).toMatch(/Migration.*has been reverted|reverted/i);

    const runOutput = execFileSync('npm', ['run', 'migration:run'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(runOutput).toMatch(/Migration.*has been executed|executed/i);
  });
});
