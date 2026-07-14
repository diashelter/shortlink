import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { LinkAccessCollector } from '../../src/modules/link-statistics/link-access-collector.service';
import { LINK_STATS_QUEUE } from '../../src/redis.module';
import { RedisService } from '../../src/redis.service';
import { createE2eApp } from './create-e2e-app';

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

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe('Link statistics public redirect collection (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let redis: RedisService;
  let queue: Queue;
  let collector: LinkAccessCollector;

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
    const email = `link-stats-${randomUUID()}@example.com`;
    await registerAndActivate(email, clientIp);
    return loginAccessToken(email, clientIp);
  }

  async function createActiveLink(
    destinationUrl: string,
  ): Promise<{ id: string; shortCode: string; destinationUrl: string }> {
    const token = await authenticatedBearer('198.51.100.40');
    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl })
      .expect(201);

    return {
      id: created.body.id as string,
      shortCode: created.body.shortCode as string,
      destinationUrl: created.body.destinationUrl as string,
    };
  }

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    redis = app.get(RedisService);
    queue = app.get<Queue>(getQueueToken(LINK_STATS_QUEUE));
    collector = app.get(LinkAccessCollector);
  });

  afterAll(async () => {
    await queue?.close();
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await deleteAllMailpitMessages();
    await redis.getClient().flushdb();
    await dataSource.manager.query(
      'TRUNCATE TABLE "link_access_events", "link_daily_aggregates", "link_daily_visitors", "link_monthly_aggregates", "link_statistics_days", "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  it('returns 302 and enqueues a sanitized access job for eligible visitors', async () => {
    const link = await createActiveLink(
      'https://example.com/stats-eligible?x=1#frag',
    );
    const addSpy = jest.spyOn(queue, 'add');

    try {
      const response = await request(app.getHttpServer())
        .get(`/${link.shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (compatible; ShortlinkE2E/1.0)')
        .set('X-Forwarded-For', '203.0.113.50')
        .redirects(0)
        .expect(302);

      expect(response.headers.location).toBe(link.destinationUrl);

      await waitUntil(() => addSpy.mock.calls.length >= 1, 5_000);

      const [, payload, options] = addSpy.mock.calls[0];
      expect(payload).toEqual(
        expect.objectContaining({
          eventId: expect.any(String),
          linkId: link.id,
          occurredAt: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
          ),
          occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          country: expect.any(String),
          visitorPseudonym: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      expect(Object.keys(payload as object).sort()).toEqual(
        [
          'country',
          'eventId',
          'linkId',
          'occurredAt',
          'occurredOn',
          'visitorPseudonym',
        ].sort(),
      );
      expect(JSON.stringify(payload)).not.toMatch(
        /203\.0\.113|Mozilla|example\.com|destination/i,
      );
      expect(options).toEqual(
        expect.objectContaining({
          jobId: expect.stringMatching(/^access-[0-9a-f-]{36}$/),
        }),
      );
    } finally {
      addSpy.mockRestore();
    }
  });

  it('returns 302 for known bots without enqueueing access collection', async () => {
    const link = await createActiveLink('https://example.com/stats-bot');
    const addSpy = jest.spyOn(queue, 'add');
    const collectSpy = jest.spyOn(collector, 'collect');

    try {
      const response = await request(app.getHttpServer())
        .get(`/${link.shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1)')
        .set('X-Forwarded-For', '203.0.113.51')
        .redirects(0)
        .expect(302);

      expect(response.headers.location).toBe(link.destinationUrl);

      await waitUntil(async () => {
        // Give fire-and-forget a chance to run; success means still no collect.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
      }, 2_000);

      expect(collectSpy).not.toHaveBeenCalled();
      expect(addSpy).not.toHaveBeenCalled();
    } finally {
      collectSpy.mockRestore();
      addSpy.mockRestore();
    }
  });

  it('keeps returning 302 when the collector rejects', async () => {
    const link = await createActiveLink('https://example.com/stats-fail');
    const collectSpy = jest
      .spyOn(collector, 'collect')
      .mockRejectedValueOnce(new Error('redis unavailable'));

    try {
      const response = await request(app.getHttpServer())
        .get(`/${link.shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (compatible; ShortlinkE2E/1.0)')
        .set('X-Forwarded-For', '203.0.113.52')
        .redirects(0)
        .expect(302);

      expect(response.headers.location).toBe(link.destinationUrl);

      await waitUntil(() => collectSpy.mock.calls.length >= 1, 5_000);
      expect(response.status).toBe(302);
    } finally {
      collectSpy.mockRestore();
    }
  });

  it('does not await a slow collector before emitting 302', async () => {
    const link = await createActiveLink('https://example.com/stats-slow');
    let releaseCollect!: () => void;
    const collectBlocker = new Promise<void>((resolve) => {
      releaseCollect = resolve;
    });

    const collectSpy = jest
      .spyOn(collector, 'collect')
      .mockImplementation(async () => {
        await collectBlocker;
      });

    try {
      const startedAt = Date.now();
      const response = await request(app.getHttpServer())
        .get(`/${link.shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (compatible; ShortlinkE2E/1.0)')
        .set('X-Forwarded-For', '203.0.113.53')
        .redirects(0)
        .expect(302);

      const elapsedMs = Date.now() - startedAt;
      expect(response.headers.location).toBe(link.destinationUrl);
      expect(elapsedMs).toBeLessThan(1_500);

      await waitUntil(() => collectSpy.mock.calls.length >= 1, 5_000);
    } finally {
      releaseCollect();
      collectSpy.mockRestore();
    }
  });

  it('returns 404 LINK_NOT_FOUND for missing codes without collecting', async () => {
    const collectSpy = jest.spyOn(collector, 'collect');
    const addSpy = jest.spyOn(queue, 'add');

    try {
      const response = await request(app.getHttpServer())
        .get('/ZZZZZZ')
        .set('User-Agent', 'Mozilla/5.0 (compatible; ShortlinkE2E/1.0)')
        .expect(404);

      expect(response.body).toEqual(
        expect.objectContaining({
          statusCode: 404,
          code: 'LINK_NOT_FOUND',
        }),
      );

      await waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
      }, 2_000);

      expect(collectSpy).not.toHaveBeenCalled();
      expect(addSpy).not.toHaveBeenCalled();
    } finally {
      collectSpy.mockRestore();
      addSpy.mockRestore();
    }
  });

  it('returns 404 for invalid and deactivated codes without collecting', async () => {
    const token = await authenticatedBearer('198.51.100.41');
    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl: 'https://example.com/stats-deactivated' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const collectSpy = jest.spyOn(collector, 'collect');
    const addSpy = jest.spyOn(queue, 'add');

    try {
      const invalid = await request(app.getHttpServer())
        .get('/bad')
        .expect(404);
      expect(invalid.body.code).toBe('LINK_NOT_FOUND');

      const deactivated = await request(app.getHttpServer())
        .get(`/${created.body.shortCode as string}`)
        .set('User-Agent', 'Mozilla/5.0 (compatible; ShortlinkE2E/1.0)')
        .expect(404);
      expect(deactivated.body.code).toBe('LINK_NOT_FOUND');

      await waitUntil(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
      }, 2_000);

      expect(collectSpy).not.toHaveBeenCalled();
      expect(addSpy).not.toHaveBeenCalled();
    } finally {
      collectSpy.mockRestore();
      addSpy.mockRestore();
    }
  });
});
