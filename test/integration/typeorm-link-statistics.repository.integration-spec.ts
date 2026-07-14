import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { LinkEntity } from '../../src/modules/links/link.entity';
import { LinkStatus } from '../../src/modules/links/link-status.enum';
import { LinkAccessEventEntity } from '../../src/modules/link-statistics/link-access-event.entity';
import { LinkDailyAggregateEntity } from '../../src/modules/link-statistics/link-daily-aggregate.entity';
import { LinkDailyVisitorEntity } from '../../src/modules/link-statistics/link-daily-visitor.entity';
import { LinkMonthlyAggregateEntity } from '../../src/modules/link-statistics/link-monthly-aggregate.entity';
import { LinkStatisticsDayEntity } from '../../src/modules/link-statistics/link-statistics-day.entity';
import { LinkStatisticsRepository } from '../../src/modules/link-statistics/link-statistics.repository';
import { TypeormLinkStatisticsRepository } from '../../src/modules/link-statistics/typeorm-link-statistics.repository';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const PSEUDONYM_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PSEUDONYM_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('TypeormLinkStatisticsRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: LinkStatisticsRepository;

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
      'TRUNCATE TABLE "link_access_events", "link_daily_aggregates", "link_daily_visitors", "link_monthly_aggregates", "link_statistics_days", "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
    repository = new TypeormLinkStatisticsRepository(dataSource);
  });

  async function createUser(email: string): Promise<AccountEntity> {
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

  async function createLink(
    userId: string,
    shortCode: string,
  ): Promise<LinkEntity> {
    const links = dataSource.getRepository(LinkEntity);
    return links.save(
      links.create({
        userId,
        shortCode,
        destinationUrl: `https://example.com/${shortCode}`,
        status: LinkStatus.ACTIVE,
      }),
    );
  }

  function accessInput(
    linkId: string,
    overrides: Partial<{
      eventId: string;
      occurredAt: Date;
      occurredOn: string;
      country: string;
      visitorPseudonym: string;
    }> = {},
  ) {
    return {
      eventId: overrides.eventId ?? randomUUID(),
      linkId,
      occurredAt: overrides.occurredAt ?? new Date('2026-07-14T12:00:00.000Z'),
      occurredOn: overrides.occurredOn ?? '2026-07-14',
      country: overrides.country ?? 'BR',
      visitorPseudonym: overrides.visitorPseudonym ?? PSEUDONYM_A,
    };
  }

  it('keeps the repository abstraction free of TypeORM and entity imports', () => {
    const interfaceSource = readFileSync(
      join(
        __dirname,
        '../../src/modules/link-statistics/link-statistics.repository.ts',
      ),
      'utf8',
    );

    expect(interfaceSource).not.toMatch(/from ['"]typeorm['"]/);
    expect(interfaceSource).not.toMatch(/\.entity['"]/);
    expect(interfaceSource).not.toMatch(/Http|express|nestjs/i);
    expect(repository).toBeInstanceOf(TypeormLinkStatisticsRepository);
    expect(repository).toBeInstanceOf(LinkStatisticsRepository);
  });

  it('records a first access with daily and monthly aggregates and unique visitor', async () => {
    const user = await createUser('first@example.com');
    const link = await createLink(user.id, 'REC001');

    await repository.recordAccess(accessInput(link.id));

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      1,
    );
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-14',
        country: 'BR',
      }),
    ).toMatchObject({ accessCount: 1, uniqueVisitorCount: 1 });
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: link.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 1, dailyUniqueVisitorCount: 1 });
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      1,
    );
  });

  it('does not increment any aggregate when the same eventId is recorded twice', async () => {
    const user = await createUser('dup-event@example.com');
    const link = await createLink(user.id, 'DUP001');
    const eventId = randomUUID();

    await repository.recordAccess(accessInput(link.id, { eventId }));
    await repository.recordAccess(
      accessInput(link.id, {
        eventId,
        country: 'US',
        visitorPseudonym: PSEUDONYM_B,
      }),
    );

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      1,
    );
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).find(),
    ).toEqual([
      expect.objectContaining({
        country: 'BR',
        accessCount: 1,
        uniqueVisitorCount: 1,
      }),
    ]);
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: link.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 1, dailyUniqueVisitorCount: 1 });
  });

  it('counts two accesses and one unique visitor for the same pseudonym on the same day', async () => {
    const user = await createUser('same-visitor@example.com');
    const link = await createLink(user.id, 'VIS002');

    await repository.recordAccess(
      accessInput(link.id, { visitorPseudonym: PSEUDONYM_A }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        visitorPseudonym: PSEUDONYM_A,
      }),
    );

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      2,
    );
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-14',
        country: 'BR',
      }),
    ).toMatchObject({ accessCount: 2, uniqueVisitorCount: 1 });
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: link.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 2, dailyUniqueVisitorCount: 1 });
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      1,
    );
  });

  it('keeps the first country for a unique visitor when later access uses another country', async () => {
    const user = await createUser('country-lock@example.com');
    const link = await createLink(user.id, 'CTR001');

    await repository.recordAccess(
      accessInput(link.id, {
        country: 'BR',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        country: 'US',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );

    const daily = await dataSource
      .getRepository(LinkDailyAggregateEntity)
      .find({ where: { linkId: link.id }, order: { country: 'ASC' } });

    expect(daily).toEqual([
      expect.objectContaining({
        country: 'BR',
        accessCount: 1,
        uniqueVisitorCount: 1,
      }),
      expect.objectContaining({
        country: 'US',
        accessCount: 1,
        uniqueVisitorCount: 0,
      }),
    ]);
    expect(
      await dataSource.getRepository(LinkDailyVisitorEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-14',
        visitorPseudonym: PSEUDONYM_A,
      }),
    ).toMatchObject({ country: 'BR' });
  });

  it('counts two unique visitors when pseudonyms differ on the same day', async () => {
    const user = await createUser('two-visitors@example.com');
    const link = await createLink(user.id, 'VIS003');

    await repository.recordAccess(
      accessInput(link.id, { visitorPseudonym: PSEUDONYM_A }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        visitorPseudonym: PSEUDONYM_B,
      }),
    );

    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-14',
        country: 'BR',
      }),
    ).toMatchObject({ accessCount: 2, uniqueVisitorCount: 2 });
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: link.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 2, dailyUniqueVisitorCount: 2 });
  });

  it('discards a late access job after the day is finalized', async () => {
    const user = await createUser('late@example.com');
    const link = await createLink(user.id, 'LATE01');

    await repository.recordAccess(
      accessInput(link.id, { occurredOn: '2026-07-13' }),
    );
    await repository.finalizeDays('2026-07-14');

    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        occurredOn: '2026-07-13',
        visitorPseudonym: PSEUDONYM_B,
      }),
    );

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      0,
    );
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      0,
    );
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-13',
        country: 'BR',
      }),
    ).toMatchObject({ accessCount: 1, uniqueVisitorCount: 1 });
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: link.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 1, dailyUniqueVisitorCount: 1 });
  });

  it('removes only events and ephemeral visitors for the closed day while keeping aggregates', async () => {
    const user = await createUser('finalize@example.com');
    const link = await createLink(user.id, 'FIN002');

    await repository.recordAccess(
      accessInput(link.id, { occurredOn: '2026-07-12' }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        occurredOn: '2026-07-13',
        visitorPseudonym: PSEUDONYM_B,
      }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        occurredOn: '2026-07-14',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );

    await repository.finalizeDays('2026-07-14');

    const events = await dataSource.getRepository(LinkAccessEventEntity).find({
      order: { occurredOn: 'ASC' },
    });
    expect(events.map((event) => event.occurredOn)).toEqual(['2026-07-14']);

    const visitors = await dataSource
      .getRepository(LinkDailyVisitorEntity)
      .find({ order: { occurredOn: 'ASC' } });
    expect(visitors.map((visitor) => visitor.occurredOn)).toEqual([
      '2026-07-14',
    ]);

    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).count(),
    ).toBe(3);
    expect(
      await dataSource.getRepository(LinkMonthlyAggregateEntity).count(),
    ).toBe(1);
    expect(
      await dataSource.getRepository(LinkStatisticsDayEntity).count(),
    ).toBe(2);
  });

  it('is idempotent when finalizeDays runs twice for the same cutoff', async () => {
    const user = await createUser('finalize-twice@example.com');
    const link = await createLink(user.id, 'FIN003');

    await repository.recordAccess(
      accessInput(link.id, { occurredOn: '2026-07-13' }),
    );

    await repository.finalizeDays('2026-07-14');
    await repository.finalizeDays('2026-07-14');

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      0,
    );
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      0,
    );
    expect(
      await dataSource.getRepository(LinkStatisticsDayEntity).count(),
    ).toBe(1);
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).findOneByOrFail({
        linkId: link.id,
        occurredOn: '2026-07-13',
        country: 'BR',
      }),
    ).toMatchObject({ accessCount: 1, uniqueVisitorCount: 1 });
  });

  it('does not finalize the cutoff day itself', async () => {
    const user = await createUser('cutoff@example.com');
    const link = await createLink(user.id, 'CUT001');

    await repository.recordAccess(
      accessInput(link.id, { occurredOn: '2026-07-14' }),
    );

    await repository.finalizeDays('2026-07-14');

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      1,
    );
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      1,
    );
    expect(
      await dataSource.getRepository(LinkStatisticsDayEntity).count(),
    ).toBe(0);
  });

  it('returns a dense chronological report with country ranking for the period', async () => {
    const user = await createUser('report@example.com');
    const link = await createLink(user.id, 'REP001');

    await repository.recordAccess(
      accessInput(link.id, {
        occurredOn: '2026-07-12',
        country: 'BR',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        occurredOn: '2026-07-12',
        country: 'US',
        visitorPseudonym: PSEUDONYM_B,
      }),
    );
    await repository.recordAccess(
      accessInput(link.id, {
        eventId: randomUUID(),
        occurredOn: '2026-07-14',
        country: 'BR',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );

    const report = await repository.getReport(link.id, {
      from: '2026-07-12',
      to: '2026-07-14',
    });

    expect(report).toEqual({
      linkId: link.id,
      period: {
        from: '2026-07-12',
        to: '2026-07-14',
        timezone: 'UTC',
      },
      totals: {
        accesses: 3,
        dailyUniqueVisitors: 3,
      },
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

  it('isolates aggregates per link when recording concurrent accesses', async () => {
    const user = await createUser('isolate@example.com');
    const linkA = await createLink(user.id, 'ISO00A');
    const linkB = await createLink(user.id, 'ISO00B');

    await repository.recordAccess(accessInput(linkA.id));
    await repository.recordAccess(
      accessInput(linkB.id, {
        eventId: randomUUID(),
        country: 'US',
        visitorPseudonym: PSEUDONYM_B,
      }),
    );

    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).count({
        where: { linkId: linkA.id },
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).count({
        where: { linkId: linkB.id },
      }),
    ).toBe(1);
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: linkA.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 1, dailyUniqueVisitorCount: 1 });
    expect(
      await dataSource
        .getRepository(LinkMonthlyAggregateEntity)
        .findOneByOrFail({
          linkId: linkB.id,
          occurredMonth: '2026-07',
        }),
    ).toMatchObject({ accessCount: 1, dailyUniqueVisitorCount: 1 });
  });
});
