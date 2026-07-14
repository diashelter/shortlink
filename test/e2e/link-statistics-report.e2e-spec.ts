import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { LinkStatisticsRepository } from '../../src/modules/link-statistics/link-statistics.repository';
import { RedisService } from '../../src/redis.service';
import { createE2eApp } from './create-e2e-app';

const MAILPIT_API = `http://${process.env.MAILPIT_HOST ?? 'mailpit'}:8025/api/v1`;
const VALID_PASSWORD = 'Valid1!pass';

const PSEUDONYM_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PSEUDONYM_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

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

type LinkStatisticsReportBody = {
  linkId: string;
  period: { from: string; to: string; timezone: string };
  totals: { accesses: number; dailyUniqueVisitors: number };
  daily: Array<{
    date: string;
    accesses: number;
    dailyUniqueVisitors: number;
  }>;
  monthly: Array<{
    month: string;
    accesses: number;
    dailyUniqueVisitors: number;
  }>;
  countries: Array<{
    country: string;
    accesses: number;
    dailyUniqueVisitors: number;
  }>;
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

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

function eachUtcDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

describe('Link statistics report HTTP (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let redis: RedisService;
  let statisticsRepository: LinkStatisticsRepository;

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

  async function authenticatedBearer(
    clientIp: string,
  ): Promise<{ email: string; token: string }> {
    const email = `link-stats-report-${randomUUID()}@example.com`;
    await registerAndActivate(email, clientIp);
    const token = await loginAccessToken(email, clientIp);
    return { email, token };
  }

  async function createLink(
    token: string,
    destinationUrl: string,
  ): Promise<{ id: string; shortCode: string }> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl })
      .expect(201);

    return {
      id: created.body.id as string,
      shortCode: created.body.shortCode as string,
    };
  }

  async function seedAccess(
    linkId: string,
    overrides: Partial<{
      eventId: string;
      occurredAt: Date;
      occurredOn: string;
      country: string;
      visitorPseudonym: string;
    }> = {},
  ): Promise<void> {
    const occurredOn = overrides.occurredOn ?? '2026-07-14';
    await statisticsRepository.recordAccess({
      eventId: overrides.eventId ?? randomUUID(),
      linkId,
      occurredAt:
        overrides.occurredAt ?? new Date(`${occurredOn}T12:00:00.000Z`),
      occurredOn,
      country: overrides.country ?? 'BR',
      visitorPseudonym: overrides.visitorPseudonym ?? PSEUDONYM_A,
    });
  }

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    redis = app.get(RedisService);
    statisticsRepository = app.get(LinkStatisticsRepository);
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
      'TRUNCATE TABLE "link_access_events", "link_daily_aggregates", "link_daily_visitors", "link_monthly_aggregates", "link_statistics_days", "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  it('rejects unauthenticated report requests with 401', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${randomUUID()}/statistics`)
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
  });

  it('applies the default 30-day UTC period when from/to are omitted', async () => {
    const { token } = await authenticatedBearer('198.51.100.60');
    const link = await createLink(token, 'https://example.com/stats-default');
    const today = utcToday();
    const from = addUtcDays(today, -29);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as LinkStatisticsReportBody;
    expect(body.period).toEqual({
      from,
      to: today,
      timezone: 'UTC',
    });
    expect(body.daily).toHaveLength(30);
    expect(body.daily[0].date).toBe(from);
    expect(body.daily[29].date).toBe(today);
    expect(body.daily.every((point) => point.accesses === 0)).toBe(true);
    expect(body.totals).toEqual({ accesses: 0, dailyUniqueVisitors: 0 });
    expect(body.countries).toEqual([]);
  });

  it('returns zeros and a dense series for an empty period', async () => {
    const { token } = await authenticatedBearer('198.51.100.61');
    const link = await createLink(token, 'https://example.com/stats-empty');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2026-07-01', to: '2026-07-03' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as LinkStatisticsReportBody;
    expect(body).toEqual({
      linkId: link.id,
      period: { from: '2026-07-01', to: '2026-07-03', timezone: 'UTC' },
      totals: { accesses: 0, dailyUniqueVisitors: 0 },
      daily: [
        { date: '2026-07-01', accesses: 0, dailyUniqueVisitors: 0 },
        { date: '2026-07-02', accesses: 0, dailyUniqueVisitors: 0 },
        { date: '2026-07-03', accesses: 0, dailyUniqueVisitors: 0 },
      ],
      monthly: [{ month: '2026-07', accesses: 0, dailyUniqueVisitors: 0 }],
      countries: [],
    });
  });

  it('returns totals, dense daily/monthly series and ranked countries for an explicit period', async () => {
    const { token } = await authenticatedBearer('198.51.100.62');
    const link = await createLink(token, 'https://example.com/stats-explicit');

    await seedAccess(link.id, {
      occurredOn: '2026-07-12',
      country: 'BR',
      visitorPseudonym: PSEUDONYM_A,
    });
    await seedAccess(link.id, {
      occurredOn: '2026-07-12',
      country: 'US',
      visitorPseudonym: PSEUDONYM_B,
    });
    await seedAccess(link.id, {
      occurredOn: '2026-07-14',
      country: 'BR',
      visitorPseudonym: PSEUDONYM_A,
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2026-07-12', to: '2026-07-14' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      linkId: link.id,
      period: { from: '2026-07-12', to: '2026-07-14', timezone: 'UTC' },
      totals: { accesses: 3, dailyUniqueVisitors: 3 },
      daily: [
        { date: '2026-07-12', accesses: 2, dailyUniqueVisitors: 2 },
        { date: '2026-07-13', accesses: 0, dailyUniqueVisitors: 0 },
        { date: '2026-07-14', accesses: 1, dailyUniqueVisitors: 1 },
      ],
      monthly: [{ month: '2026-07', accesses: 3, dailyUniqueVisitors: 3 }],
      countries: [
        { country: 'BR', accesses: 2, dailyUniqueVisitors: 2 },
        { country: 'US', accesses: 1, dailyUniqueVisitors: 1 },
      ],
    });
  });

  it('rejects from after to with 422 VALIDATION_ERROR', async () => {
    const { token } = await authenticatedBearer('198.51.100.63');
    const link = await createLink(token, 'https://example.com/stats-order');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2026-07-14', to: '2026-07-01' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        errors: expect.any(Object),
      }),
    );
  });

  it('rejects a period that exceeds 12 inclusive calendar months with 422', async () => {
    const { token } = await authenticatedBearer('198.51.100.64');
    const link = await createLink(token, 'https://example.com/stats-span');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2025-07-01', to: '2026-07-01' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        errors: expect.any(Object),
      }),
    );
  });

  it('rejects a partial period (only from or only to) with 422', async () => {
    const { token } = await authenticatedBearer('198.51.100.65');
    const link = await createLink(token, 'https://example.com/stats-partial');

    const onlyFrom = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2026-07-01' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(onlyFrom.body.code).toBe('VALIDATION_ERROR');

    const onlyTo = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ to: '2026-07-14' })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);

    expect(onlyTo.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when another user requests the report', async () => {
    const owner = await authenticatedBearer('198.51.100.66');
    const other = await authenticatedBearer('198.51.100.67');
    const link = await createLink(
      owner.token,
      'https://example.com/stats-forbidden',
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(403);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 403,
        code: 'FORBIDDEN',
      }),
    );
  });

  it('returns 404 LINK_NOT_FOUND for a missing link', async () => {
    const { token } = await authenticatedBearer('198.51.100.68');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${randomUUID()}/statistics`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
        code: 'LINK_NOT_FOUND',
      }),
    );
  });

  it('preserves history for a deactivated link owned by the requester', async () => {
    const { token } = await authenticatedBearer('198.51.100.69');
    const link = await createLink(
      token,
      'https://example.com/stats-deactivated-history',
    );

    await seedAccess(link.id, {
      occurredOn: '2026-07-10',
      country: 'BR',
      visitorPseudonym: PSEUDONYM_A,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/links/${link.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2026-07-10', to: '2026-07-10' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as LinkStatisticsReportBody;
    expect(body.totals).toEqual({ accesses: 1, dailyUniqueVisitors: 1 });
    expect(body.daily).toEqual([
      { date: '2026-07-10', accesses: 1, dailyUniqueVisitors: 1 },
    ]);
    expect(body.countries).toEqual([
      { country: 'BR', accesses: 1, dailyUniqueVisitors: 1 },
    ]);
  });

  it('accepts an exactly 12-month inclusive calendar span', async () => {
    const { token } = await authenticatedBearer('198.51.100.70');
    const link = await createLink(token, 'https://example.com/stats-12m');

    const response = await request(app.getHttpServer())
      .get(`/api/v1/links/${link.id}/statistics`)
      .query({ from: '2025-08-01', to: '2026-07-31' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as LinkStatisticsReportBody;
    expect(body.period).toEqual({
      from: '2025-08-01',
      to: '2026-07-31',
      timezone: 'UTC',
    });
    expect(body.daily).toHaveLength(
      eachUtcDate('2025-08-01', '2026-07-31').length,
    );
    expect(body.monthly).toHaveLength(12);
    expect(body.monthly[0].month).toBe('2025-08');
    expect(body.monthly[11].month).toBe('2026-07');
  });
});
