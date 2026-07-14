import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { AuthRepository } from '../../src/modules/auth/auth.repository';
import { Password } from '../../src/modules/auth/password.value-object';
import { PasswordHash } from '../../src/modules/auth/password-hash.value-object';
import { PasswordHasherService } from '../../src/modules/auth/password-hasher.service';
import { RedisService } from '../../src/redis.service';
import { createE2eApp } from './create-e2e-app';
import { createTrustedHttpsAgent, trustedHttpsRequest } from './https-client';

const MAILPIT_API = `http://${process.env.MAILPIT_HOST ?? 'mailpit'}:8025/api/v1`;
const VALID_PASSWORD = 'Valid1!pass';
const NEW_VALID_PASSWORD = 'NewValid1!pass';
const GENERIC_ACCEPTED = { message: 'Accepted.' };

type MailpitMessageSummary = {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Snippet: string;
};

type MailpitMessagesResponse = {
  messages: MailpitMessageSummary[];
};

async function deleteAllMailpitMessages(): Promise<void> {
  const response = await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Mailpit delete failed: ${response.status}`);
  }
}

async function listMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const response = await fetch(`${MAILPIT_API}/messages`);
  if (!response.ok) {
    throw new Error(`Mailpit list failed: ${response.status}`);
  }
  const body = (await response.json()) as MailpitMessagesResponse;
  return body.messages ?? [];
}

async function waitForMailpitMessage(
  predicate: (message: MailpitMessageSummary) => boolean,
  timeoutMs = 15_000,
): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const match = (await listMailpitMessages()).find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for Mailpit message');
}

async function countMailpitMessagesFor(email: string): Promise<number> {
  return (await listMailpitMessages()).filter((message) =>
    message.To.some((to) => to.Address === email),
  ).length;
}

type MailpitMessageDetail = {
  ID: string;
  Text?: string;
  HTML?: string;
  Snippet?: string;
};

async function getMailpitMessage(id: string): Promise<MailpitMessageDetail> {
  const response = await fetch(`${MAILPIT_API}/message/${id}`);
  if (!response.ok) {
    throw new Error(`Mailpit message fetch failed: ${response.status}`);
  }
  return (await response.json()) as MailpitMessageDetail;
}

function extractSixDigitCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error('Activation code not found in email body');
  }
  return match[1];
}

async function waitForActivationCode(email: string): Promise<string> {
  const summary = await waitForMailpitMessage(
    (entry) =>
      entry.To.some((to) => to.Address === email) &&
      /activat|verif/i.test(entry.Subject),
  );
  const detail = await getMailpitMessage(summary.ID);
  const body = detail.Text || detail.HTML || detail.Snippet || summary.Snippet;
  return extractSixDigitCode(body);
}

async function waitForLoginCode(email: string): Promise<string> {
  const summary = await waitForMailpitMessage(
    (entry) =>
      entry.To.some((to) => to.Address === email) && /login/i.test(entry.Subject),
  );
  const detail = await getMailpitMessage(summary.ID);
  const body = detail.Text || detail.HTML || detail.Snippet || summary.Snippet;
  return extractSixDigitCode(body);
}

function extractResetTokenFromFragment(text: string): string {
  const match = text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!match) {
    throw new Error('Reset token not found in email fragment');
  }
  return match[1];
}

async function waitForResetEmailBody(email: string): Promise<string> {
  const summary = await waitForMailpitMessage(
    (entry) =>
      entry.To.some((to) => to.Address === email) &&
      /reset|password/i.test(entry.Subject),
  );
  const detail = await getMailpitMessage(summary.ID);
  return detail.Text || detail.HTML || detail.Snippet || summary.Snippet;
}

const REFRESH_COOKIE_NAME =
  process.env.REFRESH_COOKIE_NAME?.trim() || 'shortlink_refresh';

const GENERIC_INVALID_VERIFICATION = {
  statusCode: 401,
  code: 'INVALID_VERIFICATION',
  message: expect.any(String),
};

function parseSetCookieHeaders(
  setCookie: string | string[] | undefined,
): string[] {
  if (!setCookie) {
    return [];
  }
  return Array.isArray(setCookie) ? setCookie : [setCookie];
}

function findRefreshCookie(setCookie: string | string[] | undefined): string | undefined {
  return parseSetCookieHeaders(setCookie).find((entry) =>
    entry.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
}

function cookiePairFromSetCookie(setCookie: string): string {
  return setCookie.split(';')[0];
}

const ALLOWED_ORIGIN = 'https://localhost:8443';

type SessionCredentials = {
  accessToken: string;
  csrfToken: string;
  refreshCookie: string;
  cookieHeader: string;
};

async function completeLoginSession(
  email: string,
  clientIp: string,
): Promise<SessionCredentials> {
  const login = await postAuthJson(
    '/api/v1/auth/login',
    { email, password: VALID_PASSWORD },
    { 'X-Forwarded-For': clientIp },
  );
  expect(login.statusCode).toBe(202);
  const challengeId = (login.body as { challengeId: string }).challengeId;
  const code = await waitForLoginCode(email);

  const verified = await postAuthJson('/api/v1/auth/verify-login', {
    challengeId,
    code,
  });
  expect(verified.statusCode).toBe(200);

  const body = verified.body as {
    accessToken: string;
    csrfToken: string;
  };
  const refreshCookie = findRefreshCookie(verified.headers['set-cookie']);
  expect(refreshCookie).toBeDefined();

  return {
    accessToken: body.accessToken,
    csrfToken: body.csrfToken,
    refreshCookie: refreshCookie!,
    cookieHeader: cookiePairFromSetCookie(refreshCookie!),
  };
}

async function postAuthJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{
  statusCode: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}> {
  const response = await trustedHttpsRequest({
    method: 'POST',
    path,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  let parsed: unknown = response.body;
  if (response.body) {
    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = response.body;
    }
  }

  return {
    statusCode: response.statusCode,
    body: parsed,
    headers: response.headers as Record<string, string | string[] | undefined>,
  };
}

async function registerAndActivate(
  email: string,
  clientIp: string,
): Promise<void> {
  const register = await postAuthJson(
    '/api/v1/auth/register',
    {
      email,
      password: VALID_PASSWORD,
      passwordConfirmation: VALID_PASSWORD,
    },
    { 'X-Forwarded-For': clientIp },
  );
  expect(register.statusCode).toBe(202);

  const code = await waitForActivationCode(email);
  const verified = await postAuthJson('/api/v1/auth/verify-email', {
    email,
    code,
  });
  expect(verified.statusCode).toBe(204);
}

describe('Auth HTTP module (e2e)', () => {
  let app: INestApplication;
  let authRepository: AuthRepository;
  let passwordHasher: PasswordHasherService;
  let redis: RedisService;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createE2eApp();
    authRepository = app.get(AuthRepository);
    passwordHasher = app.get(PasswordHasherService);
    redis = app.get(RedisService);
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await deleteAllMailpitMessages();
    await redis.getClient().flushdb();
    await dataSource.manager.query(
      'TRUNCATE TABLE "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  it('rejects register payloads with unknown fields using the 422 envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.com',
        password: 'Valid1!pass',
        passwordConfirmation: 'Valid1!pass',
        role: 'ADMIN',
      })
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.objectContaining({
          role: expect.any(Array),
        }),
      }),
    );
  });

  it('rejects invalid login payloads using the 422 envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'not-an-email',
        password: '',
      })
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.any(Object),
      }),
    );
    expect(response.body.errors.email).toEqual(expect.any(Array));
    expect(response.body.errors.password).toEqual(expect.any(Array));
  });

  it('rejects the test-only protected route without a JWT using the error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/test/protected')
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
    expect(response.body.errors).toBeUndefined();
  });

  it('trusts the local CA for HTTPS without disabling TLS validation', async () => {
    const agent = createTrustedHttpsAgent();
    expect(agent.options.rejectUnauthorized).not.toBe(false);

    const response = await trustedHttpsRequest({
      method: 'GET',
      path: '/api/v1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello World!');
  });

  it('returns the 422 validation envelope over trusted HTTPS', async () => {
    const response = await trustedHttpsRequest({
      method: 'POST',
      path: '/api/v1/auth/register',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'Valid1!pass',
        passwordConfirmation: 'Valid1!pass',
        unexpected: true,
      }),
    });

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as {
      statusCode: number;
      code: string;
      message: string;
      errors?: Record<string, string[]>;
    };

    expect(body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.objectContaining({
          unexpected: expect.any(Array),
        }),
      }),
    );
  });

  describe('POST /api/v1/auth/register and resend-email-verification', () => {
    it('creates a PENDING account and delivers an activation email via Mailpit', async () => {
      const email = `new-${randomUUID()}@example.com`;
      const clientIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

      const response = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': clientIp },
      );

      expect(response.statusCode).toBe(202);
      expect(response.body).toEqual(GENERIC_ACCEPTED);

      const account = await authRepository.findAccountByEmail(email);
      expect(account).not.toBeNull();
      expect(account!.status).toBe(AccountStatus.PENDING);

      const message = await waitForMailpitMessage(
        (entry) =>
          entry.To.some((to) => to.Address === email) &&
          /activat|verif/i.test(entry.Subject),
      );
      expect(message).toBeDefined();
    });

    it('returns the same generic 202 for active accounts without sending email', async () => {
      const email = `active-${randomUUID()}@example.com`;
      const hash = await passwordHasher.hash(Password.create(VALID_PASSWORD));
      await authRepository.createPendingAccount({
        email,
        passwordHash: hash.value,
      });
      const created = await authRepository.findAccountByEmail(email);
      await authRepository.activateAccount(created!.id);
      await deleteAllMailpitMessages();

      const response = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': '198.51.100.10' },
      );

      expect(response.statusCode).toBe(202);
      expect(response.body).toEqual(GENERIC_ACCEPTED);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await countMailpitMessagesFor(email)).toBe(0);
    });

    it('preserves the pending password and skips email during cooldown', async () => {
      const email = `pending-${randomUUID()}@example.com`;
      const originalPassword = 'Original1!pass';
      const alternatePassword = 'Alternate1!pass';
      const clientIp = '198.51.100.20';

      const first = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: originalPassword,
          passwordConfirmation: originalPassword,
        },
        { 'X-Forwarded-For': clientIp },
      );
      expect(first.statusCode).toBe(202);

      await waitForMailpitMessage((entry) =>
        entry.To.some((to) => to.Address === email),
      );
      expect(await countMailpitMessagesFor(email)).toBe(1);

      const accountAfterFirst = await authRepository.findAccountByEmail(email);
      expect(accountAfterFirst).not.toBeNull();
      const originalHash = accountAfterFirst!.passwordHash;

      const second = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: alternatePassword,
          passwordConfirmation: alternatePassword,
        },
        { 'X-Forwarded-For': clientIp },
      );
      expect(second.statusCode).toBe(202);
      expect(second.body).toEqual(GENERIC_ACCEPTED);

      const accountAfterSecond = await authRepository.findAccountByEmail(email);
      expect(accountAfterSecond!.passwordHash).toBe(originalHash);
      await expect(
        passwordHasher.compare(
          Password.create(originalPassword),
          PasswordHash.create(accountAfterSecond!.passwordHash),
        ),
      ).resolves.toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await countMailpitMessagesFor(email)).toBe(1);
    });

    it('resends activation after cooldown and rate-limits by email', async () => {
      const email = `resend-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.30';

      const first = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': clientIp },
      );
      expect(first.statusCode).toBe(202);

      const account = await authRepository.findAccountByEmail(email);
      expect(account).not.toBeNull();
      await waitForMailpitMessage((entry) =>
        entry.To.some((to) => to.Address === email),
      );

      await redis.del(`shortlink:auth:resend:activation:${account!.id}`);

      const resend = await postAuthJson(
        '/api/v1/auth/resend-email-verification',
        { email },
        { 'X-Forwarded-For': clientIp },
      );
      expect(resend.statusCode).toBe(202);
      expect(resend.body).toEqual(GENERIC_ACCEPTED);

      const deadline = Date.now() + 15_000;
      while ((await countMailpitMessagesFor(email)) < 2) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for second activation email');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      for (let index = 0; index < 2; index += 1) {
        await redis.del(`shortlink:auth:resend:activation:${account!.id}`);
        const allowed = await postAuthJson(
          '/api/v1/auth/resend-email-verification',
          { email },
          { 'X-Forwarded-For': `198.51.100.${31 + index}` },
        );
        expect(allowed.statusCode).toBe(202);
      }

      await redis.del(`shortlink:auth:resend:activation:${account!.id}`);
      const limited = await postAuthJson(
        '/api/v1/auth/resend-email-verification',
        { email },
        { 'X-Forwarded-For': '198.51.100.33' },
      );
      expect(limited.statusCode).toBe(429);
      expect(limited.body).toEqual(
        expect.objectContaining({
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: expect.any(String),
        }),
      );
    });

    it('rate-limits register by IP after 10 requests per hour', async () => {
      const clientIp = '198.51.100.40';

      for (let index = 0; index < 10; index += 1) {
        const response = await postAuthJson(
          '/api/v1/auth/register',
          {
            email: `ip-limit-${index}-${randomUUID()}@example.com`,
            password: VALID_PASSWORD,
            passwordConfirmation: VALID_PASSWORD,
          },
          { 'X-Forwarded-For': clientIp },
        );
        expect(response.statusCode).toBe(202);
      }

      const blocked = await postAuthJson(
        '/api/v1/auth/register',
        {
          email: `ip-limit-blocked-${randomUUID()}@example.com`,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': clientIp },
      );

      expect(blocked.statusCode).toBe(429);
      expect(blocked.body).toEqual(
        expect.objectContaining({
          statusCode: 429,
          code: 'RATE_LIMITED',
        }),
      );
    });

    it('does not enumerate unknown or active emails on resend', async () => {
      const activeEmail = `active-resend-${randomUUID()}@example.com`;
      const hash = await passwordHasher.hash(Password.create(VALID_PASSWORD));
      await authRepository.createPendingAccount({
        email: activeEmail,
        passwordHash: hash.value,
      });
      const active = await authRepository.findAccountByEmail(activeEmail);
      await authRepository.activateAccount(active!.id);
      await deleteAllMailpitMessages();

      const unknown = await postAuthJson(
        '/api/v1/auth/resend-email-verification',
        { email: `missing-${randomUUID()}@example.com` },
        { 'X-Forwarded-For': '198.51.100.50' },
      );
      const activeResend = await postAuthJson(
        '/api/v1/auth/resend-email-verification',
        { email: activeEmail },
        { 'X-Forwarded-For': '198.51.100.51' },
      );

      expect(unknown.statusCode).toBe(202);
      expect(activeResend.statusCode).toBe(202);
      expect(unknown.body).toEqual(GENERIC_ACCEPTED);
      expect(activeResend.body).toEqual(GENERIC_ACCEPTED);

      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await listMailpitMessages()).toHaveLength(0);
    });

    it('rejects weak passwords with 422 and does not create an account', async () => {
      const email = `weak-${randomUUID()}@example.com`;

      const response = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: 'weak',
          passwordConfirmation: 'weak',
        },
        { 'X-Forwarded-For': '198.51.100.60' },
      );

      expect(response.statusCode).toBe(422);
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          errors: expect.objectContaining({
            password: expect.any(Array),
          }),
        }),
      );
      await expect(authRepository.findAccountByEmail(email)).resolves.toBeNull();
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('activates a pending account with a valid Mailpit code and rejects reuse', async () => {
      const email = `verify-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.70';

      const register = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': clientIp },
      );
      expect(register.statusCode).toBe(202);

      const code = await waitForActivationCode(email);

      const verified = await postAuthJson('/api/v1/auth/verify-email', {
        email,
        code,
      });
      expect(verified.statusCode).toBe(204);
      expect(verified.body).toBe('');

      const account = await authRepository.findAccountByEmail(email);
      expect(account).not.toBeNull();
      expect(account!.status).toBe(AccountStatus.ACTIVE);

      const reused = await postAuthJson('/api/v1/auth/verify-email', {
        email,
        code,
      });
      expect(reused.statusCode).toBe(401);
      expect(reused.body).toEqual(
        expect.objectContaining(GENERIC_INVALID_VERIFICATION),
      );
      expect((reused.body as { errors?: unknown }).errors).toBeUndefined();
    });

    it('returns the same generic error for invalid, missing, and unknown cases', async () => {
      const email = `verify-invalid-${randomUUID()}@example.com`;

      const register = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': '198.51.100.71' },
      );
      expect(register.statusCode).toBe(202);

      const code = await waitForActivationCode(email);
      const wrongCode = code === '000000' ? '111111' : '000000';

      const invalid = await postAuthJson('/api/v1/auth/verify-email', {
        email,
        code: wrongCode,
      });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.body).toEqual(
        expect.objectContaining(GENERIC_INVALID_VERIFICATION),
      );

      const unknown = await postAuthJson('/api/v1/auth/verify-email', {
        email: `missing-${randomUUID()}@example.com`,
        code: '123456',
      });
      expect(unknown.statusCode).toBe(401);
      expect(unknown.body).toEqual(
        expect.objectContaining(GENERIC_INVALID_VERIFICATION),
      );

      await redis.del(
        `shortlink:auth:verification:activation:${(await authRepository.findAccountByEmail(email))!.id}`,
      );
      const expired = await postAuthJson('/api/v1/auth/verify-email', {
        email,
        code,
      });
      expect(expired.statusCode).toBe(401);
      expect(expired.body).toEqual(
        expect.objectContaining(GENERIC_INVALID_VERIFICATION),
      );

      const pending = await authRepository.findAccountByEmail(email);
      expect(pending!.status).toBe(AccountStatus.PENDING);
    });

    it('returns a generic error for already active accounts without revealing status', async () => {
      const email = `verify-active-${randomUUID()}@example.com`;
      const hash = await passwordHasher.hash(Password.create(VALID_PASSWORD));
      await authRepository.createPendingAccount({
        email,
        passwordHash: hash.value,
      });
      const created = await authRepository.findAccountByEmail(email);
      await authRepository.activateAccount(created!.id);

      const response = await postAuthJson('/api/v1/auth/verify-email', {
        email,
        code: '123456',
      });

      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual(
        expect.objectContaining(GENERIC_INVALID_VERIFICATION),
      );
      expect((response.body as { errors?: unknown }).errors).toBeUndefined();
    });
  });

  describe('POST /api/v1/auth/login and verify-login', () => {
    it('rejects pending accounts with EMAIL_NOT_VERIFIED and does not send login mail', async () => {
      const email = `pending-login-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.80';

      const register = await postAuthJson(
        '/api/v1/auth/register',
        {
          email,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': clientIp },
      );
      expect(register.statusCode).toBe(202);
      await waitForActivationCode(email);
      await deleteAllMailpitMessages();

      const login = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: VALID_PASSWORD },
        { 'X-Forwarded-For': clientIp },
      );

      expect(login.statusCode).toBe(403);
      expect(login.body).toEqual(
        expect.objectContaining({
          statusCode: 403,
          code: 'EMAIL_NOT_VERIFIED',
          message: expect.any(String),
        }),
      );
      expect((login.body as { challengeId?: unknown }).challengeId).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await countMailpitMessagesFor(email)).toBe(0);
    });

    it('completes login via Mailpit code, sets a secure refresh cookie, and authorizes the protected route', async () => {
      const email = `login-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.81';

      await registerAndActivate(email, clientIp);
      await deleteAllMailpitMessages();

      const login = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: VALID_PASSWORD },
        { 'X-Forwarded-For': clientIp },
      );
      expect(login.statusCode).toBe(202);
      expect(login.body).toEqual(
        expect.objectContaining({
          challengeId: expect.any(String),
          expiresAt: expect.any(String),
        }),
      );

      const challengeId = (login.body as { challengeId: string }).challengeId;
      const code = await waitForLoginCode(email);

      const verified = await postAuthJson('/api/v1/auth/verify-login', {
        challengeId,
        code,
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.body).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          expiresIn: expect.any(Number),
          csrfToken: expect.any(String),
        }),
      );
      expect(
        (verified.body as { refreshToken?: unknown }).refreshToken,
      ).toBeUndefined();

      const refreshCookie = findRefreshCookie(verified.headers['set-cookie']);
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie!.toLowerCase()).toContain('httponly');
      expect(refreshCookie!.toLowerCase()).toContain('secure');
      expect(refreshCookie!.toLowerCase()).toMatch(/samesite=lax/);
      expect(refreshCookie!).toMatch(/Path=\/api\/v1\/auth/i);

      const accessToken = (verified.body as { accessToken: string }).accessToken;
      const protectedOk = await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(protectedOk.body).toEqual({ ok: true });
    });

    it('revokes the previous session when a new login is completed', async () => {
      const email = `relogin-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.82';

      await registerAndActivate(email, clientIp);
      await deleteAllMailpitMessages();

      const firstLogin = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: VALID_PASSWORD },
        { 'X-Forwarded-For': clientIp },
      );
      expect(firstLogin.statusCode).toBe(202);
      const firstChallenge = (firstLogin.body as { challengeId: string })
        .challengeId;
      const firstCode = await waitForLoginCode(email);
      const firstVerified = await postAuthJson('/api/v1/auth/verify-login', {
        challengeId: firstChallenge,
        code: firstCode,
      });
      expect(firstVerified.statusCode).toBe(200);
      const firstAccessToken = (firstVerified.body as { accessToken: string })
        .accessToken;

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${firstAccessToken}`)
        .expect(200);

      await deleteAllMailpitMessages();

      const secondLogin = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: VALID_PASSWORD },
        { 'X-Forwarded-For': '198.51.100.83' },
      );
      expect(secondLogin.statusCode).toBe(202);
      const secondChallenge = (secondLogin.body as { challengeId: string })
        .challengeId;
      const secondCode = await waitForLoginCode(email);
      const secondVerified = await postAuthJson('/api/v1/auth/verify-login', {
        challengeId: secondChallenge,
        code: secondCode,
      });
      expect(secondVerified.statusCode).toBe(200);
      const secondAccessToken = (secondVerified.body as { accessToken: string })
        .accessToken;

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${firstAccessToken}`)
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${secondAccessToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/auth/refresh and logout', () => {
    it('rotates refresh, rejects reuse, and logout invalidates the JWT immediately', async () => {
      const email = `refresh-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.90';

      await registerAndActivate(email, clientIp);
      await deleteAllMailpitMessages();

      const session = await completeLoginSession(email, clientIp);

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      const refreshed = await postAuthJson(
        '/api/v1/auth/refresh',
        {},
        {
          Cookie: session.cookieHeader,
          'X-CSRF-Token': session.csrfToken,
          Origin: ALLOWED_ORIGIN,
        },
      );
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.body).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          expiresIn: expect.any(Number),
        }),
      );
      expect(
        (refreshed.body as { csrfToken?: unknown }).csrfToken,
      ).toBeUndefined();
      expect(
        (refreshed.body as { refreshToken?: unknown }).refreshToken,
      ).toBeUndefined();

      const rotatedCookie = findRefreshCookie(refreshed.headers['set-cookie']);
      expect(rotatedCookie).toBeDefined();
      expect(cookiePairFromSetCookie(rotatedCookie!)).not.toBe(
        session.cookieHeader,
      );

      const newAccessToken = (refreshed.body as { accessToken: string })
        .accessToken;

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);

      const reuse = await postAuthJson(
        '/api/v1/auth/refresh',
        {},
        {
          Cookie: session.cookieHeader,
          'X-CSRF-Token': session.csrfToken,
          Origin: ALLOWED_ORIGIN,
        },
      );
      expect(reuse.statusCode).toBe(401);
      expect(reuse.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: 'SESSION_INVALID',
          message: expect.any(String),
        }),
      );

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(401);

      await deleteAllMailpitMessages();
      const relogin = await completeLoginSession(email, '198.51.100.91');

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${relogin.accessToken}`)
        .expect(200);

      const loggedOut = await postAuthJson(
        '/api/v1/auth/logout',
        {},
        {
          Cookie: relogin.cookieHeader,
          'X-CSRF-Token': relogin.csrfToken,
          Origin: ALLOWED_ORIGIN,
        },
      );
      expect(loggedOut.statusCode).toBe(204);
      expect(loggedOut.body).toBe('');

      const clearedCookie = findRefreshCookie(loggedOut.headers['set-cookie']);
      expect(clearedCookie).toBeDefined();
      expect(clearedCookie!.toLowerCase()).toMatch(
        /(?:max-age=0|expires=)/i,
      );

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${relogin.accessToken}`)
        .expect(401);
    });

    it('rejects refresh without CSRF token or with a disallowed origin', async () => {
      const email = `csrf-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.92';

      await registerAndActivate(email, clientIp);
      await deleteAllMailpitMessages();
      const session = await completeLoginSession(email, clientIp);

      const missingCsrf = await postAuthJson(
        '/api/v1/auth/refresh',
        {},
        {
          Cookie: session.cookieHeader,
          Origin: ALLOWED_ORIGIN,
        },
      );
      expect(missingCsrf.statusCode).toBe(403);
      expect(missingCsrf.body).toEqual(
        expect.objectContaining({
          statusCode: 403,
          code: 'CSRF_VALIDATION_FAILED',
          message: expect.any(String),
        }),
      );

      const wrongOrigin = await postAuthJson(
        '/api/v1/auth/refresh',
        {},
        {
          Cookie: session.cookieHeader,
          'X-CSRF-Token': session.csrfToken,
          Origin: 'https://evil.example',
        },
      );
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.body).toEqual(
        expect.objectContaining({
          statusCode: 403,
          code: 'CSRF_VALIDATION_FAILED',
          message: expect.any(String),
        }),
      );

      const wrongCsrf = await postAuthJson(
        '/api/v1/auth/logout',
        {},
        {
          Cookie: session.cookieHeader,
          'X-CSRF-Token': 'not-the-session-csrf-token-value-xxxxx',
          Origin: ALLOWED_ORIGIN,
        },
      );
      expect(wrongCsrf.statusCode).toBe(403);
      expect(wrongCsrf.body).toEqual(
        expect.objectContaining({
          statusCode: 403,
          code: 'CSRF_VALIDATION_FAILED',
          message: expect.any(String),
        }),
      );
    });
  });

  describe('POST /api/v1/auth/forgot-password and reset-password', () => {
    it('returns a generic 202 for missing, pending, and active accounts', async () => {
      const missingEmail = `missing-reset-${randomUUID()}@example.com`;
      const pendingEmail = `pending-reset-${randomUUID()}@example.com`;
      const activeEmail = `active-reset-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.110';

      const missing = await postAuthJson(
        '/api/v1/auth/forgot-password',
        { email: missingEmail },
        { 'X-Forwarded-For': clientIp },
      );
      expect(missing.statusCode).toBe(202);
      expect(missing.body).toEqual(GENERIC_ACCEPTED);

      const pendingRegister = await postAuthJson(
        '/api/v1/auth/register',
        {
          email: pendingEmail,
          password: VALID_PASSWORD,
          passwordConfirmation: VALID_PASSWORD,
        },
        { 'X-Forwarded-For': '198.51.100.111' },
      );
      expect(pendingRegister.statusCode).toBe(202);
      await deleteAllMailpitMessages();

      const pendingForgot = await postAuthJson(
        '/api/v1/auth/forgot-password',
        { email: pendingEmail },
        { 'X-Forwarded-For': '198.51.100.112' },
      );
      expect(pendingForgot.statusCode).toBe(202);
      expect(pendingForgot.body).toEqual(GENERIC_ACCEPTED);
      await expect(
        waitForMailpitMessage(
          (entry) =>
            entry.To.some((to) => to.Address === pendingEmail) &&
            /reset|password/i.test(entry.Subject),
          2_000,
        ),
      ).rejects.toThrow(/Timed out/);

      await registerAndActivate(activeEmail, '198.51.100.113');
      await deleteAllMailpitMessages();

      const activeForgot = await postAuthJson(
        '/api/v1/auth/forgot-password',
        { email: activeEmail },
        { 'X-Forwarded-For': '198.51.100.114' },
      );
      expect(activeForgot.statusCode).toBe(202);
      expect(activeForgot.body).toEqual(GENERIC_ACCEPTED);

      const body = await waitForResetEmailBody(activeEmail);
      expect(body).toMatch(/#token=/);
      expect(body).not.toMatch(/\?token=/);
    });

    it('resets password from Mailpit fragment token, revokes the old JWT, and allows login with the new password', async () => {
      const email = `reset-flow-${randomUUID()}@example.com`;
      const clientIp = '198.51.100.120';

      await registerAndActivate(email, clientIp);
      await deleteAllMailpitMessages();

      const session = await completeLoginSession(email, clientIp);

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      await deleteAllMailpitMessages();

      const forgot = await postAuthJson(
        '/api/v1/auth/forgot-password',
        { email },
        { 'X-Forwarded-For': '198.51.100.121' },
      );
      expect(forgot.statusCode).toBe(202);
      expect(forgot.body).toEqual(GENERIC_ACCEPTED);

      const resetEmailBody = await waitForResetEmailBody(email);
      expect(resetEmailBody).toMatch(/#token=/);
      expect(resetEmailBody).not.toMatch(/\?token=/);
      const token = extractResetTokenFromFragment(resetEmailBody);

      const reset = await postAuthJson('/api/v1/auth/reset-password', {
        token,
        password: NEW_VALID_PASSWORD,
        passwordConfirmation: NEW_VALID_PASSWORD,
      });
      expect(reset.statusCode).toBe(204);

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);

      const oldPasswordLogin = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: VALID_PASSWORD },
        { 'X-Forwarded-For': '198.51.100.122' },
      );
      expect(oldPasswordLogin.statusCode).toBe(401);

      await deleteAllMailpitMessages();

      const newPasswordLogin = await postAuthJson(
        '/api/v1/auth/login',
        { email, password: NEW_VALID_PASSWORD },
        { 'X-Forwarded-For': '198.51.100.123' },
      );
      expect(newPasswordLogin.statusCode).toBe(202);
      const challengeId = (newPasswordLogin.body as { challengeId: string })
        .challengeId;
      const code = await waitForLoginCode(email);
      const verified = await postAuthJson('/api/v1/auth/verify-login', {
        challengeId,
        code,
      });
      expect(verified.statusCode).toBe(200);
      const newAccessToken = (verified.body as { accessToken: string })
        .accessToken;

      await request(app.getHttpServer())
        .get('/api/v1/auth/test/protected')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .expect(200);
    });

    it('rejects invalid reset passwords with the 422 envelope', async () => {
      const response = await postAuthJson('/api/v1/auth/reset-password', {
        token: 'opaque-reset-token',
        password: 'weak',
        passwordConfirmation: 'weak',
      });

      expect(response.statusCode).toBe(422);
      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: expect.any(String),
          errors: expect.objectContaining({
            password: expect.any(Array),
          }),
        }),
      );
    });
  });
});
