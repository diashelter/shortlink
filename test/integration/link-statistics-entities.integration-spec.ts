import { DataSource, QueryFailedError } from 'typeorm';
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

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const PSEUDONYM_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PSEUDONYM_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('Link statistics entities and migration (integration)', () => {
  let dataSource: DataSource;

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

  it('enforces unique eventId on link_access_events', async () => {
    const user = await createUser('events@example.com');
    const link = await createLink(user.id, 'EVT001');
    const events = dataSource.getRepository(LinkAccessEventEntity);
    const occurredAt = new Date('2026-07-14T12:00:00.000Z');

    await events.insert({
      id: EVENT_ID,
      linkId: link.id,
      occurredAt,
      occurredOn: '2026-07-14',
      country: 'BR',
      visitorPseudonym: PSEUDONYM_A,
    });

    await expect(
      events.insert({
        id: EVENT_ID,
        linkId: link.id,
        occurredAt,
        occurredOn: '2026-07-14',
        country: 'US',
        visitorPseudonym: PSEUDONYM_B,
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('enforces unique daily aggregate per link, day and country', async () => {
    const user = await createUser('daily-agg@example.com');
    const link = await createLink(user.id, 'DAY001');
    const aggregates = dataSource.getRepository(LinkDailyAggregateEntity);

    await aggregates.insert({
      linkId: link.id,
      occurredOn: '2026-07-14',
      country: 'BR',
      accessCount: 1,
      uniqueVisitorCount: 1,
    });

    await expect(
      aggregates.insert({
        linkId: link.id,
        occurredOn: '2026-07-14',
        country: 'BR',
        accessCount: 2,
        uniqueVisitorCount: 1,
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('enforces unique daily visitor per link, day and visitorPseudonym', async () => {
    const user = await createUser('visitors@example.com');
    const link = await createLink(user.id, 'VIS001');
    const visitors = dataSource.getRepository(LinkDailyVisitorEntity);

    await visitors.insert({
      linkId: link.id,
      occurredOn: '2026-07-14',
      visitorPseudonym: PSEUDONYM_A,
      country: 'BR',
    });

    await expect(
      visitors.insert({
        linkId: link.id,
        occurredOn: '2026-07-14',
        visitorPseudonym: PSEUDONYM_A,
        country: 'US',
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('enforces unique monthly aggregate per link and month', async () => {
    const user = await createUser('monthly@example.com');
    const link = await createLink(user.id, 'MON001');
    const aggregates = dataSource.getRepository(LinkMonthlyAggregateEntity);

    await aggregates.insert({
      linkId: link.id,
      occurredMonth: '2026-07',
      accessCount: 10,
      dailyUniqueVisitorCount: 4,
    });

    await expect(
      aggregates.insert({
        linkId: link.id,
        occurredMonth: '2026-07',
        accessCount: 11,
        dailyUniqueVisitorCount: 5,
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('enforces unique finalized day per link and occurredOn', async () => {
    const user = await createUser('days@example.com');
    const link = await createLink(user.id, 'FIN001');
    const days = dataSource.getRepository(LinkStatisticsDayEntity);

    await days.insert({
      linkId: link.id,
      occurredOn: '2026-07-13',
      finalizedAt: new Date('2026-07-14T01:00:00.000Z'),
    });

    await expect(
      days.insert({
        linkId: link.id,
        occurredOn: '2026-07-13',
        finalizedAt: new Date('2026-07-14T01:05:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('cascades delete of link to all statistics tables', async () => {
    const user = await createUser('cascade@example.com');
    const link = await createLink(user.id, 'CAS001');
    const occurredAt = new Date('2026-07-14T12:00:00.000Z');

    await dataSource.getRepository(LinkAccessEventEntity).save({
      id: EVENT_ID,
      linkId: link.id,
      occurredAt,
      occurredOn: '2026-07-14',
      country: 'BR',
      visitorPseudonym: PSEUDONYM_A,
    });
    await dataSource.getRepository(LinkDailyAggregateEntity).save({
      linkId: link.id,
      occurredOn: '2026-07-14',
      country: 'BR',
      accessCount: 1,
      uniqueVisitorCount: 1,
    });
    await dataSource.getRepository(LinkDailyVisitorEntity).save({
      linkId: link.id,
      occurredOn: '2026-07-14',
      visitorPseudonym: PSEUDONYM_A,
      country: 'BR',
    });
    await dataSource.getRepository(LinkMonthlyAggregateEntity).save({
      linkId: link.id,
      occurredMonth: '2026-07',
      accessCount: 1,
      dailyUniqueVisitorCount: 1,
    });
    await dataSource.getRepository(LinkStatisticsDayEntity).save({
      linkId: link.id,
      occurredOn: '2026-07-13',
      finalizedAt: new Date('2026-07-14T01:00:00.000Z'),
    });

    await dataSource.getRepository(LinkEntity).delete({ id: link.id });

    expect(await dataSource.getRepository(LinkAccessEventEntity).count()).toBe(
      0,
    );
    expect(
      await dataSource.getRepository(LinkDailyAggregateEntity).count(),
    ).toBe(0);
    expect(await dataSource.getRepository(LinkDailyVisitorEntity).count()).toBe(
      0,
    );
    expect(
      await dataSource.getRepository(LinkMonthlyAggregateEntity).count(),
    ).toBe(0);
    expect(
      await dataSource.getRepository(LinkStatisticsDayEntity).count(),
    ).toBe(0);
  });

  it('allows Unknown as country and has no IP or user-agent columns', async () => {
    const user = await createUser('privacy@example.com');
    const link = await createLink(user.id, 'UNK001');
    const events = dataSource.getRepository(LinkAccessEventEntity);

    const saved = await events.save(
      events.create({
        id: EVENT_ID,
        linkId: link.id,
        occurredAt: new Date('2026-07-14T12:00:00.000Z'),
        occurredOn: '2026-07-14',
        country: 'Unknown',
        visitorPseudonym: PSEUDONYM_A,
      }),
    );

    expect(saved.country).toBe('Unknown');

    const columns = (await dataSource.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (
           'link_access_events',
           'link_daily_aggregates',
           'link_daily_visitors',
           'link_monthly_aggregates',
           'link_statistics_days'
         )
       ORDER BY table_name, column_name`,
    )) as Array<{ table_name: string; column_name: string }>;

    const columnNames = columns.map((row) => row.column_name.toLowerCase());
    expect(columnNames).not.toEqual(
      expect.arrayContaining([
        'ip',
        'ipaddress',
        'ip_address',
        'useragent',
        'user_agent',
      ]),
    );

    const sensitive = columnNames.filter((name) =>
      /ip|user.?agent|useragent/i.test(name),
    );
    expect(sensitive).toEqual([]);
  });
});
