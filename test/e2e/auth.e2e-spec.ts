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

async function postAuthJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; body: unknown }> {
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

  return { statusCode: response.statusCode, body: parsed };
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
});
