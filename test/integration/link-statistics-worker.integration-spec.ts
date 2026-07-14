import { getQueueToken } from '@nestjs/bullmq';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Job, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DatabaseModule } from '../../src/database.module';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { LinkEntity } from '../../src/modules/links/link.entity';
import { LinkStatus } from '../../src/modules/links/link-status.enum';
import { LinkAccessEventEntity } from '../../src/modules/link-statistics/link-access-event.entity';
import { LinkDailyAggregateEntity } from '../../src/modules/link-statistics/link-daily-aggregate.entity';
import { LinkDailyVisitorEntity } from '../../src/modules/link-statistics/link-daily-visitor.entity';
import { LinkStatisticsDayEntity } from '../../src/modules/link-statistics/link-statistics-day.entity';
import { LinkStatisticsFinalizerService } from '../../src/modules/link-statistics/link-statistics-finalizer.service';
import { LinkStatisticsModule } from '../../src/modules/link-statistics/link-statistics.module';
import { LinkStatisticsProcessor } from '../../src/modules/link-statistics/link-statistics.processor';
import { LinkStatisticsRepository } from '../../src/modules/link-statistics/link-statistics.repository';
import {
  RECORD_LINK_ACCESS_JOB,
  RecordLinkAccessJobData,
} from '../../src/modules/link-statistics/link-access-collector.service';
import { LINK_STATS_QUEUE, RedisModule } from '../../src/redis.module';
import { WorkerModule } from '../../src/worker.module';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const PSEUDONYM =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out waiting for condition');
}

function asJob<T>(name: string, data: T): Job<T> {
  return { name, data } as Job<T>;
}

describe('Link statistics worker and finalizer (integration)', () => {
  jest.setTimeout(30_000);

  let moduleRef: TestingModule;
  let app: INestApplicationContext;
  let dataSource: DataSource;
  let queue: Queue;
  let accounts: Repository<AccountEntity>;
  let links: Repository<LinkEntity>;
  let events: Repository<LinkAccessEventEntity>;
  let visitors: Repository<LinkDailyVisitorEntity>;
  let days: Repository<LinkStatisticsDayEntity>;
  let aggregates: Repository<LinkDailyAggregateEntity>;
  let finalizer: LinkStatisticsFinalizerService;
  let processor: LinkStatisticsProcessor;
  let repository: LinkStatisticsRepository;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        RedisModule,
        LinkStatisticsModule,
        ScheduleModule.forRoot(),
      ],
      providers: [LinkStatisticsProcessor, LinkStatisticsFinalizerService],
    }).compile();

    app = moduleRef;
    await app.init();

    dataSource = moduleRef.get(DataSource);
    queue = moduleRef.get<Queue>(getQueueToken(LINK_STATS_QUEUE));
    accounts = dataSource.getRepository(AccountEntity);
    links = dataSource.getRepository(LinkEntity);
    events = dataSource.getRepository(LinkAccessEventEntity);
    visitors = dataSource.getRepository(LinkDailyVisitorEntity);
    days = dataSource.getRepository(LinkStatisticsDayEntity);
    aggregates = dataSource.getRepository(LinkDailyAggregateEntity);
    finalizer = moduleRef.get(LinkStatisticsFinalizerService);
    processor = moduleRef.get(LinkStatisticsProcessor);
    repository = moduleRef.get(LinkStatisticsRepository);
  });

  afterAll(async () => {
    try {
      const registry = moduleRef.get(SchedulerRegistry);
      for (const name of [...registry.getCronJobs().keys()]) {
        registry.deleteCronJob(name);
      }
    } catch {
      // Schedule registry may already be torn down.
    }
    await queue?.close();
    await app?.close();
  });

  beforeEach(async () => {
    await waitUntil(async () => {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'paused',
      );
      return (
        counts.waiting === 0 &&
        counts.active === 0 &&
        counts.delayed === 0 &&
        counts.paused === 0
      );
    }, 10_000).catch(() => undefined);

    try {
      await queue.obliterate({ force: true });
    } catch {
      // Production queue-worker may race obliterate; continue with truncate.
    }

    await accounts.manager.query(
      'TRUNCATE TABLE "link_access_events", "link_daily_aggregates", "link_daily_visitors", "link_monthly_aggregates", "link_statistics_days", "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
  });

  async function createLink(
    email: string,
    shortCode: string,
  ): Promise<LinkEntity> {
    const account = await accounts.save(
      accounts.create({
        email,
        status: AccountStatus.ACTIVE,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );

    return links.save(
      links.create({
        userId: account.id,
        shortCode,
        destinationUrl: `https://example.com/${shortCode}`,
        status: LinkStatus.ACTIVE,
      }),
    );
  }

  function jobData(
    linkId: string,
    overrides: Partial<RecordLinkAccessJobData> = {},
  ): RecordLinkAccessJobData {
    return {
      eventId: randomUUID(),
      linkId,
      occurredAt: '2026-07-13T12:00:00.000Z',
      occurredOn: '2026-07-13',
      country: 'BR',
      visitorPseudonym: PSEUDONYM,
      ...overrides,
    };
  }

  async function seedAccess(linkId: string, data?: RecordLinkAccessJobData) {
    const payload = data ?? jobData(linkId);
    await repository.recordAccess({
      eventId: payload.eventId,
      linkId: payload.linkId,
      occurredAt: new Date(payload.occurredAt),
      occurredOn: payload.occurredOn,
      country: payload.country,
      visitorPseudonym: payload.visitorPseudonym,
    });
    return payload;
  }

  it('processes record-link-access through the queue and persists aggregates', async () => {
    const link = await createLink(
      `worker-${randomUUID()}@example.com`,
      'wrk001',
    );
    const data = jobData(link.id);

    await queue.add(RECORD_LINK_ACCESS_JOB, data, {
      jobId: `access-${data.eventId}`,
    });

    await waitUntil(async () => {
      const count = await events.count({ where: { id: data.eventId } });
      return count === 1;
    });

    const event = await events.findOneByOrFail({ id: data.eventId });
    expect(event.linkId).toBe(link.id);
    expect(String(event.occurredOn).slice(0, 10)).toBe('2026-07-13');
    expect(event.country).toBe('BR');
    expect(event.visitorPseudonym).toBe(PSEUDONYM);

    const daily = await aggregates.find({
      where: { linkId: link.id },
    });
    expect(daily).toHaveLength(1);
    expect(daily[0].accessCount).toBe(1);
    expect(daily[0].uniqueVisitorCount).toBe(1);
  });

  it('ignores unknown jobs with a sanitized warning log', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    try {
      await processor.process(
        asJob('unknown-link-stats-job', {
          eventId: randomUUID(),
          ip: '203.0.113.50',
          userAgent: 'Mozilla/5.0',
          destinationUrl: 'https://secret.example/path',
        }) as unknown as Job<RecordLinkAccessJobData>,
      );

      const messages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(
        messages.some((message) => /unknown-link-stats-job/.test(message)),
      ).toBe(true);
      expect(messages.join('\n')).not.toMatch(/203\.0\.113/);
      expect(messages.join('\n')).not.toMatch(/Mozilla/);
      expect(messages.join('\n')).not.toMatch(/secret\.example/);
      expect(await events.count()).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('finalizes previous UTC days and removes ephemeral event rows', async () => {
    const link = await createLink(
      `finalize-${randomUUID()}@example.com`,
      'fin001',
    );
    await seedAccess(link.id);

    await finalizer.finalizePreviousUtcDays();

    expect(await events.count({ where: { linkId: link.id } })).toBe(0);
    expect(await visitors.count({ where: { linkId: link.id } })).toBe(0);

    const closedDays = await days.find({ where: { linkId: link.id } });
    expect(closedDays).toHaveLength(1);
    expect(String(closedDays[0].occurredOn).slice(0, 10)).toBe('2026-07-13');
    expect(closedDays[0].finalizedAt).toBeInstanceOf(Date);

    const daily = await aggregates.find({ where: { linkId: link.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0].accessCount).toBe(1);
  });

  it('keeps finalizer execution idempotent when run repeatedly', async () => {
    const link = await createLink(
      `idempotent-${randomUUID()}@example.com`,
      'fin002',
    );
    await seedAccess(link.id);

    await finalizer.finalizePreviousUtcDays();
    await finalizer.finalizePreviousUtcDays();

    expect(await days.count({ where: { linkId: link.id } })).toBe(1);
    expect(await events.count({ where: { linkId: link.id } })).toBe(0);
    expect(await visitors.count({ where: { linkId: link.id } })).toBe(0);

    const daily = await aggregates.find({ where: { linkId: link.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0].accessCount).toBe(1);
  });

  it('registers the day-close cron only in the worker process, not the API', async () => {
    const appSource = readFileSync(
      join(__dirname, '../../src/app.module.ts'),
      'utf8',
    );
    const workerSource = readFileSync(
      join(__dirname, '../../src/worker.module.ts'),
      'utf8',
    );

    expect(appSource).not.toMatch(/ScheduleModule/);
    expect(appSource).not.toMatch(/LinkStatisticsFinalizerService/);
    expect(appSource).not.toMatch(/LinkStatisticsProcessor/);
    expect(workerSource).toMatch(/ScheduleModule\.forRoot/);
    expect(workerSource).toMatch(/LinkStatisticsFinalizerService/);
    expect(workerSource).toMatch(/LinkStatisticsProcessor/);

    const workerRegistry = moduleRef.get(SchedulerRegistry);
    const cronJobs = [...workerRegistry.getCronJobs().entries()];
    expect(cronJobs.length).toBeGreaterThanOrEqual(1);

    const finalizerCron = cronJobs.find(([, job]) => {
      const cronTime = job as {
        cronTime?: { source?: string; timeZone?: string | null };
      };
      return (
        cronTime.cronTime?.source === '0 01 * * *' &&
        cronTime.cronTime?.timeZone === 'UTC'
      );
    });
    expect(finalizerCron).toBeDefined();

    const apiModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    try {
      await apiModule.init();
      expect(() => apiModule.get(SchedulerRegistry)).toThrow();
      expect(() => apiModule.get(LinkStatisticsFinalizerService)).toThrow();
      expect(() => apiModule.get(LinkStatisticsProcessor)).toThrow();
    } finally {
      await apiModule.close();
    }
  });

  it('discards late access jobs for a finalized day through the processor', async () => {
    const link = await createLink(`late-${randomUUID()}@example.com`, 'late01');
    await seedAccess(link.id);
    await finalizer.finalizePreviousUtcDays();
    expect(await events.count()).toBe(0);

    const late = jobData(link.id, {
      eventId: randomUUID(),
      visitorPseudonym: 'b'.repeat(64),
    });
    await processor.process(asJob(RECORD_LINK_ACCESS_JOB, late));

    expect(await events.count({ where: { id: late.eventId } })).toBe(0);
    const daily = await aggregates.find({ where: { linkId: link.id } });
    expect(daily).toHaveLength(1);
    expect(daily[0].accessCount).toBe(1);
    expect(daily[0].uniqueVisitorCount).toBe(1);
  });

  it('wires WorkerModule with ScheduleModule and link statistics worker providers', async () => {
    const workerModuleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    try {
      await workerModuleRef.init();
      expect(workerModuleRef.get(LinkStatisticsProcessor)).toBeInstanceOf(
        LinkStatisticsProcessor,
      );
      expect(
        workerModuleRef.get(LinkStatisticsFinalizerService),
      ).toBeInstanceOf(LinkStatisticsFinalizerService);
      expect(workerModuleRef.get(SchedulerRegistry)).toBeDefined();
    } finally {
      try {
        const registry = workerModuleRef.get(SchedulerRegistry);
        for (const name of [...registry.getCronJobs().keys()]) {
          registry.deleteCronJob(name);
        }
      } catch {
        // ignore
      }
      await workerModuleRef.close();
    }
  });
});
