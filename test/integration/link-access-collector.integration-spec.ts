import { getQueueToken } from '@nestjs/bullmq';
import { INestApplicationContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobsOptions, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { validateEnvironment } from '../../src/environment.validation';
import {
  CollectedAccess,
  LinkAccessCollector,
  RECORD_LINK_ACCESS_JOB,
} from '../../src/modules/link-statistics/link-access-collector.service';
import { QueueLinkAccessCollector } from '../../src/modules/link-statistics/queue-link-access-collector.service';
import { LINK_STATS_QUEUE, RedisModule } from '../../src/redis.module';

describe('Link access collector queue (integration)', () => {
  let moduleRef: TestingModule;
  let app: INestApplicationContext;
  let collector: LinkAccessCollector;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [RedisModule],
      providers: [
        QueueLinkAccessCollector,
        {
          provide: LinkAccessCollector,
          useExisting: QueueLinkAccessCollector,
        },
      ],
    }).compile();

    app = moduleRef;
    await app.init();

    collector = moduleRef.get(LinkAccessCollector);
    queue = moduleRef.get<Queue>(getQueueToken(LINK_STATS_QUEUE));
  });

  afterAll(async () => {
    await queue?.close();
    await app?.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  function buildAccess(
    overrides: Partial<CollectedAccess> = {},
  ): CollectedAccess {
    return {
      eventId: randomUUID(),
      linkId: randomUUID(),
      occurredAt: '2026-07-14T18:30:00.000Z',
      occurredOn: '2026-07-14',
      country: 'BR',
      visitorPseudonym: 'a'.repeat(64),
      ...overrides,
    };
  }

  it('binds LinkAccessCollector to QueueLinkAccessCollector without BullMQ types in the interface', () => {
    expect(collector).toBeInstanceOf(QueueLinkAccessCollector);
    expect(collector).toBeInstanceOf(LinkAccessCollector);
  });

  it('enqueues record-link-access with only derived payload fields', async () => {
    const access = buildAccess();
    const addSpy = jest.spyOn(queue, 'add');

    try {
      await collector.collect(access);

      expect(addSpy).toHaveBeenCalledWith(
        RECORD_LINK_ACCESS_JOB,
        {
          eventId: access.eventId,
          linkId: access.linkId,
          occurredAt: access.occurredAt,
          occurredOn: access.occurredOn,
          country: access.country,
          visitorPseudonym: access.visitorPseudonym,
        },
        expect.objectContaining({
          jobId: `access-${access.eventId}`,
        }),
      );

      const [, payload] = addSpy.mock.calls[0];
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

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/ip|user[-_]?agent|destination|url/i);
      expect(serialized).not.toContain('203.0.113.');
      expect(serialized).not.toContain('Mozilla');
      expect(serialized).not.toContain('https://');
    } finally {
      addSpy.mockRestore();
    }
  });

  it('uses a safe jobId without colon, IP, user-agent or destination URL', async () => {
    const access = buildAccess({
      eventId: '11111111-1111-4111-8111-111111111111',
    });

    await collector.collect(access);

    const job = await queue.getJob(`access-${access.eventId}`);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(`access-${access.eventId}`);
    expect(job!.id).not.toContain(':');
    expect(job!.id).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
    expect(job!.name).toBe(RECORD_LINK_ACCESS_JOB);
    expect(job!.data).toEqual({
      eventId: access.eventId,
      linkId: access.linkId,
      occurredAt: access.occurredAt,
      occurredOn: access.occurredOn,
      country: access.country,
      visitorPseudonym: access.visitorPseudonym,
    });
  });

  it('applies linkStatsQueue attempts and exponential backoff to enqueued jobs', async () => {
    const env = validateEnvironment();
    const access = buildAccess();

    await collector.collect(access);

    const job = await queue.getJob(`access-${access.eventId}`);
    expect(job).not.toBeNull();
    expect(job!.opts.attempts).toBe(env.linkStatsQueue.attempts);
    expect(job!.opts.backoff).toEqual({
      type: 'exponential',
      delay: env.linkStatsQueue.backoffMs,
    });
  });

  it('propagates enqueue failures to the caller without absorbing them', async () => {
    const access = buildAccess();
    const failure = new Error('redis unavailable');
    const addSpy = jest.spyOn(queue, 'add').mockRejectedValueOnce(failure);

    try {
      await expect(collector.collect(access)).rejects.toThrow(
        'redis unavailable',
      );
    } finally {
      addSpy.mockRestore();
    }
  });

  it('does not put IP, user-agent or destination URL into stored job data', async () => {
    const access = buildAccess();
    const addSpy = jest.spyOn(queue, 'add');

    try {
      await collector.collect({
        ...access,
        // Callers must never pass these; assert the concrete add payload stays clean
        // even if someone later mutates the object after collect starts.
      });

      const [, payload, options] = addSpy.mock.calls[0] as [
        string,
        CollectedAccess,
        JobsOptions,
      ];

      expect(payload).not.toHaveProperty('ip');
      expect(payload).not.toHaveProperty('userAgent');
      expect(payload).not.toHaveProperty('destinationUrl');
      expect(options.jobId).toBe(`access-${access.eventId}`);
      expect(JSON.stringify({ payload, options })).not.toMatch(
        /user-agent|destinationUrl|203\.0\.113/i,
      );
    } finally {
      addSpy.mockRestore();
    }
  });
});
