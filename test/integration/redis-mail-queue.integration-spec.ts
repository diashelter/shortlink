import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { MailModule } from '../../src/mail.module';
import { AUTH_EMAIL_QUEUE, RedisModule } from '../../src/redis.module';
import { RedisService } from '../../src/redis.service';
import { SmtpMailService } from '../../src/smtp-mail.service';

describe('Redis, BullMQ and SMTP (integration)', () => {
  let moduleRef: TestingModule;
  let redisService: RedisService;
  let smtpMailService: SmtpMailService;
  let authEmailQueue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [RedisModule, MailModule],
    }).compile();

    redisService = moduleRef.get(RedisService);
    smtpMailService = moduleRef.get(SmtpMailService);
    authEmailQueue = moduleRef.get<Queue>(getQueueToken(AUTH_EMAIL_QUEUE));
  });

  afterAll(async () => {
    if (authEmailQueue) {
      await authEmailQueue.close();
    }
    await moduleRef?.close();
  });

  it('pings Compose Redis and round-trips values without process-local memory', async () => {
    const key = `shortlink:test:t6:${Date.now()}`;
    const value = `value-${Date.now()}`;

    await expect(redisService.ping()).resolves.toBe('PONG');

    await redisService.set(key, value, 60);
    await expect(redisService.get(key)).resolves.toBe(value);

    const otherClient = redisService.getClient().duplicate();
    try {
      await expect(otherClient.get(key)).resolves.toBe(value);
    } finally {
      await otherClient.quit();
      await redisService.del(key);
    }
  });

  it('verifies SMTP connectivity to Mailpit and sends a test message', async () => {
    await expect(smtpMailService.verify()).resolves.toBe(true);

    const info = await smtpMailService.sendMail({
      to: 't6-integration@shortlink.local',
      subject: 'T6 SMTP connectivity',
      text: 'Integration probe — no secrets.',
    });

    expect(info.messageId).toBeDefined();
    expect(info.accepted).toEqual(
      expect.arrayContaining(['t6-integration@shortlink.local']),
    );
  });

  it('enqueues a BullMQ job that lands in shared Redis', async () => {
    const job = await authEmailQueue.add(
      't6-connectivity-probe',
      { purpose: 'integration-test' },
      { removeOnComplete: true, removeOnFail: true },
    );

    expect(job.id).toBeDefined();

    const stored = await authEmailQueue.getJob(job.id!);
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe('t6-connectivity-probe');
    expect(stored?.data).toEqual({ purpose: 'integration-test' });

    const redisClient = redisService.getClient();
    const bullKeys = await redisClient.keys(`bull:${AUTH_EMAIL_QUEUE}:*`);
    expect(bullKeys.length).toBeGreaterThan(0);

    await stored?.remove();
  });
});
