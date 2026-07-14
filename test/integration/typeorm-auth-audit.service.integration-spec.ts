import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { AuthAuditService } from '../../src/modules/auth/auth-audit.service';
import { AuthAuditEventType } from '../../src/modules/auth/auth.types';
import { TypeormAuthAuditService } from '../../src/modules/auth/typeorm-auth-audit.service';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const SECRET_PASSWORD = 'SuperSecretPassword1!';
const SECRET_CODE = '847291';
const SECRET_REFRESH = 'opaque-refresh-token-value-abc123';
const SECRET_RESET = 'opaque-reset-token-value-xyz789';
const RAW_EMAIL = 'victim@example.com';
const HEADER_VALUE = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret';

describe('TypeormAuthAuditService (integration)', () => {
  let dataSource: DataSource;
  let audit: AuthAuditService;

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
    audit = new TypeormAuthAuditService(dataSource);
  });

  it('exposes AuthAuditService without TypeORM imports in the interface module', () => {
    const interfaceSource = readFileSync(
      join(__dirname, '../../src/modules/auth/auth-audit.service.ts'),
      'utf8',
    );

    expect(interfaceSource).not.toMatch(/from ['"]typeorm['"]/);
    expect(interfaceSource).not.toMatch(/\.entity['"]/);
    expect(audit).toBeInstanceOf(TypeormAuthAuditService);
    expect(audit).toBeInstanceOf(AuthAuditService);
  });

  it('persists happy-path session, lock, reset, and login-failure events', async () => {
    const account = await createAccount(dataSource, 'audit-user@example.com');
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const ipHash = 'ip-hash-abc';

    const created = await audit.record({
      userId: account.id,
      type: AuthAuditEventType.SESSION_CREATED,
      sessionId,
      ipHash,
      metadata: { reason: 'login_completed', emailHash: 'email-hash-1' },
    });

    const revoked = await audit.record({
      userId: account.id,
      type: AuthAuditEventType.SESSION_REVOKED,
      sessionId,
      ipHash,
      metadata: { reason: 'LOGOUT' },
    });

    const locked = await audit.record({
      userId: account.id,
      type: AuthAuditEventType.LOGIN_LOCKED,
      ipHash,
      metadata: { reason: 'failed_attempts_exceeded', locked: true },
    });

    const resetRequested = await audit.record({
      userId: account.id,
      type: AuthAuditEventType.PASSWORD_RESET_REQUESTED,
      ipHash,
      metadata: { emailHash: 'email-hash-1' },
    });

    const resetCompleted = await audit.record({
      userId: account.id,
      type: AuthAuditEventType.PASSWORD_RESET_COMPLETED,
      ipHash,
      metadata: { sessionsRevoked: true },
    });

    const loginFailure = await audit.record({
      type: AuthAuditEventType.LOGIN_FAILURE,
      ipHash,
      metadata: {
        reason: 'invalid_credentials',
        emailHash: 'email-hash-unknown',
      },
    });

    expect(created.type).toBe(AuthAuditEventType.SESSION_CREATED);
    expect(revoked.type).toBe(AuthAuditEventType.SESSION_REVOKED);
    expect(locked.type).toBe(AuthAuditEventType.LOGIN_LOCKED);
    expect(resetRequested.type).toBe(
      AuthAuditEventType.PASSWORD_RESET_REQUESTED,
    );
    expect(resetCompleted.type).toBe(
      AuthAuditEventType.PASSWORD_RESET_COMPLETED,
    );
    expect(loginFailure.type).toBe(AuthAuditEventType.LOGIN_FAILURE);
    expect(loginFailure.userId).toBeNull();

    const rows = (await dataSource.query(
      'SELECT type, "userId", "sessionId", "ipHash", metadata FROM "auth_audit_events" ORDER BY "createdAt" ASC, type ASC',
    )) as Array<{
      type: string;
      userId: string | null;
      sessionId: string | null;
      ipHash: string | null;
      metadata: Record<string, unknown> | null;
    }>;

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.type)).toEqual(
      expect.arrayContaining([
        AuthAuditEventType.SESSION_CREATED,
        AuthAuditEventType.SESSION_REVOKED,
        AuthAuditEventType.LOGIN_LOCKED,
        AuthAuditEventType.PASSWORD_RESET_REQUESTED,
        AuthAuditEventType.PASSWORD_RESET_COMPLETED,
        AuthAuditEventType.LOGIN_FAILURE,
      ]),
    );

    const sessionCreated = rows.find(
      (row) => row.type === AuthAuditEventType.SESSION_CREATED,
    );
    expect(sessionCreated?.userId).toBe(account.id);
    expect(sessionCreated?.sessionId).toBe(sessionId);
    expect(sessionCreated?.ipHash).toBe(ipHash);
    expect(sessionCreated?.metadata).toEqual({
      reason: 'login_completed',
      emailHash: 'email-hash-1',
    });
  });

  it('does not persist passwords, codes, tokens, raw email, or header contents', async () => {
    const account = await createAccount(dataSource, RAW_EMAIL);

    await audit.record({
      userId: account.id,
      type: AuthAuditEventType.LOGIN_FAILURE,
      ipHash: 'ip-hash-safe',
      metadata: {
        password: SECRET_PASSWORD,
        passwordConfirmation: SECRET_PASSWORD,
        code: SECRET_CODE,
        verificationCode: SECRET_CODE,
        refreshToken: SECRET_REFRESH,
        resetToken: SECRET_RESET,
        token: SECRET_RESET,
        email: RAW_EMAIL,
        authorization: HEADER_VALUE,
        cookie: `refresh=${SECRET_REFRESH}`,
        headers: HEADER_VALUE,
        reason: 'invalid_credentials',
        emailHash: 'safe-email-hash',
        accidentalEmail: RAW_EMAIL,
      },
    });

    const rows = (await dataSource.query(
      'SELECT type, metadata FROM "auth_audit_events"',
    )) as Array<{ type: string; metadata: Record<string, unknown> | null }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(AuthAuditEventType.LOGIN_FAILURE);
    expect(rows[0].metadata).toEqual({
      reason: 'invalid_credentials',
      emailHash: 'safe-email-hash',
    });

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(SECRET_PASSWORD);
    expect(serialized).not.toContain(SECRET_CODE);
    expect(serialized).not.toContain(SECRET_REFRESH);
    expect(serialized).not.toContain(SECRET_RESET);
    expect(serialized).not.toContain(RAW_EMAIL);
    expect(serialized).not.toContain(HEADER_VALUE);
    expect(serialized).not.toContain('Bearer ');
  });
});

async function createAccount(
  dataSource: DataSource,
  email: string,
): Promise<AccountEntity> {
  const accounts = dataSource.getRepository(AccountEntity);
  return accounts.save(
    accounts.create({
      email,
      status: AccountStatus.ACTIVE,
      role: AccountRole.USER,
      passwordHash: BCRYPT_HASH,
    }),
  );
}
