import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { RedisService } from '../../src/redis.service';
import { createE2eApp } from './create-e2e-app';
import { trustedHttpsRequest } from './https-client';

const MAILPIT_API = `http://${process.env.MAILPIT_HOST ?? 'mailpit'}:8025/api/v1`;
const VALID_PASSWORD = 'Valid1!pass';

type MailpitMessageSummary = {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Snippet: string;
};

type MailpitMessagesResponse = {
  messages: MailpitMessageSummary[];
};

type MailpitMessageDetail = {
  ID: string;
  Text?: string;
  HTML?: string;
  Snippet?: string;
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
      entry.To.some((to) => to.Address === email) &&
      /login/i.test(entry.Subject),
  );
  const detail = await getMailpitMessage(summary.ID);
  const body = detail.Text || detail.HTML || detail.Snippet || summary.Snippet;
  return extractSixDigitCode(body);
}

describe('Links management HTTP (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: RedisService;

  async function registerAndActivate(
    email: string,
    clientIp: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', clientIp)
      .send({
        email,
        password: VALID_PASSWORD,
        passwordConfirmation: VALID_PASSWORD,
      })
      .expect(202);

    const code = await waitForActivationCode(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ email, code })
      .expect(204);
  }

  async function loginAccessToken(
    email: string,
    clientIp: string,
  ): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({ email, password: VALID_PASSWORD })
      .expect(202);

    const challengeId = (login.body as { challengeId: string }).challengeId;
    const code = await waitForLoginCode(email);

    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-login')
      .send({ challengeId, code })
      .expect(200);

    return (verified.body as { accessToken: string }).accessToken;
  }

  async function authenticatedBearer(clientIp: string): Promise<string> {
    const email = `links-${randomUUID()}@example.com`;
    await registerAndActivate(email, clientIp);
    return loginAccessToken(email, clientIp);
  }

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await deleteAllMailpitMessages();
    await redis.getClient().flushdb();
    await dataSource.manager.query(
      'TRUNCATE TABLE "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  it('rejects unauthenticated management requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/links')
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
  });

  it('creates, reuses, lists, deactivates and reactivates owned links', async () => {
    const token = await authenticatedBearer('198.51.100.10');
    const destinationUrl = 'https://example.com/path?q=1#frag';

    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl })
      .expect(201);

    expect(created.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        shortCode: expect.stringMatching(/^[A-Z0-9]{6}$/),
        destinationUrl: 'https://example.com/path?q=1#frag',
        shortUrl: expect.stringMatching(/^https:\/\/localhost:8443\/[A-Z0-9]{6}$/),
        status: 'ACTIVE',
      }),
    );

    const reused = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl })
      .expect(200);

    expect(reused.body.id).toBe(created.body.id);
    expect(reused.body.shortCode).toBe(created.body.shortCode);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listed.body).toEqual({
      items: [expect.objectContaining({ id: created.body.id })],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('DEACTIVATED');
      });

    const activeOnly = await request(app.getHttpServer())
      .get('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(activeOnly.body.items).toEqual([]);
    expect(activeOnly.body.meta.total).toBe(0);

    const deactivated = await request(app.getHttpServer())
      .get('/api/v1/links?status=deactivated')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deactivated.body.items).toHaveLength(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ACTIVE');
        expect(body.shortCode).toBe(created.body.shortCode);
      });
  });

  it('isolates links between users and rejects invalid payloads', async () => {
    const ownerToken = await authenticatedBearer('198.51.100.11');
    const otherToken = await authenticatedBearer('198.51.100.12');

    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ destinationUrl: 'https://example.com/owned' })
      .expect(201);

    const otherList = await request(app.getHttpServer())
      .get('/api/v1/links')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(otherList.body.items).toEqual([]);

    const forbidden = await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);

    expect(forbidden.body).toEqual(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ destinationUrl: 'https://example.com', extra: true })
      .expect(422);

    expect(invalid.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        errors: expect.objectContaining({
          extra: expect.any(Array),
        }),
      }),
    );

    const badPage = await request(app.getHttpServer())
      .get('/api/v1/links?page=0')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(422);

    expect(badPage.body.code).toBe('VALIDATION_ERROR');
  });

  it('enforces the active link limit', async () => {
    const token = await authenticatedBearer('198.51.100.13');

    for (let index = 0; index < 10; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/links')
        .set('Authorization', `Bearer ${token}`)
        .send({ destinationUrl: `https://example.com/limit-${index}` })
        .expect(201);
    }

    const limited = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl: 'https://example.com/limit-over' })
      .expect(409);

    expect(limited.body).toEqual(
      expect.objectContaining({
        statusCode: 409,
        code: 'LINK_LIMIT_REACHED',
      }),
    );
  });

  it('resolves public short codes without auth and keeps /api/v1/links protected', async () => {
    const token = await authenticatedBearer('198.51.100.14');
    const destinationUrl = 'https://example.com/public-resolve?x=1#frag';

    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl })
      .expect(201);

    const shortCode = created.body.shortCode as string;
    const cacheKey = `shortlink:links:resolution:${shortCode}`;

    const malformed = await request(app.getHttpServer()).get('/bad').expect(404);
    expect(malformed.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
        code: 'LINK_NOT_FOUND',
      }),
    );

    const missing = await request(app.getHttpServer())
      .get('/ZZZZZZ')
      .expect(404);
    expect(missing.body.code).toBe('LINK_NOT_FOUND');

    const resolved = await request(app.getHttpServer())
      .get(`/${shortCode}`)
      .redirects(0)
      .expect(302);
    expect(resolved.headers.location).toBe(destinationUrl);

    expect(await redis.get(cacheKey)).toBe(destinationUrl);

    const cached = await request(app.getHttpServer())
      .get(`/${shortCode}`)
      .redirects(0)
      .expect(302);
    expect(cached.headers.location).toBe(destinationUrl);

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await redis.get(cacheKey)).toBeNull();

    await request(app.getHttpServer())
      .get(`/${shortCode}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/reactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const afterReactivate = await request(app.getHttpServer())
      .get(`/${shortCode}`)
      .redirects(0)
      .expect(302);
    expect(afterReactivate.headers.location).toBe(destinationUrl);

    await request(app.getHttpServer()).get('/api/v1/links').expect(401);

    const httpsResolve = await trustedHttpsRequest({
      method: 'GET',
      path: `/${shortCode}`,
    });
    expect(httpsResolve.statusCode).toBe(302);
    expect(httpsResolve.headers.location).toBe(destinationUrl);
  });
});
