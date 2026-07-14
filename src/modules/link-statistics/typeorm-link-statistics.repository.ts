import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LinkAccessEventEntity } from './link-access-event.entity';
import { LinkDailyAggregateEntity } from './link-daily-aggregate.entity';
import { LinkDailyVisitorEntity } from './link-daily-visitor.entity';
import { LinkMonthlyAggregateEntity } from './link-monthly-aggregate.entity';
import { LinkStatisticsDayEntity } from './link-statistics-day.entity';
import { LinkStatisticsRepository } from './link-statistics.repository';
import {
  AccessEventInput,
  LinkStatisticsCountryPoint,
  LinkStatisticsDailyPoint,
  LinkStatisticsMonthlyPoint,
  LinkStatisticsReport,
  StatisticsPeriod,
} from './link-statistics.types';

type LinkDayRow = {
  linkId: string;
  occurredOn: string | Date;
};

type AggregateSumRow = {
  accesses: string;
  dailyUniqueVisitors: string;
};

type CountrySumRow = {
  country: string;
  accesses: string;
  dailyUniqueVisitors: string;
};

type MonthlySumRow = {
  occurredMonth: string;
  accessCount: number;
  dailyUniqueVisitorCount: number;
};

@Injectable()
export class TypeormLinkStatisticsRepository extends LinkStatisticsRepository {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async recordAccess(input: AccessEventInput): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockLinkDay(manager, input.linkId, input.occurredOn);

      const finalized = await manager.findOne(LinkStatisticsDayEntity, {
        where: { linkId: input.linkId, occurredOn: input.occurredOn },
      });
      if (finalized) {
        return;
      }

      const insertedEvents: Array<{ id: string }> = await manager.query(
        `INSERT INTO "link_access_events"
          ("id", "linkId", "occurredAt", "occurredOn", "country", "visitorPseudonym")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("id") DO NOTHING
         RETURNING "id"`,
        [
          input.eventId,
          input.linkId,
          input.occurredAt,
          input.occurredOn,
          input.country,
          input.visitorPseudonym,
        ],
      );

      if (insertedEvents.length === 0) {
        return;
      }

      const occurredMonth = input.occurredOn.slice(0, 7);

      await manager.query(
        `INSERT INTO "link_daily_aggregates"
          ("linkId", "occurredOn", "country", "accessCount", "uniqueVisitorCount")
         VALUES ($1, $2, $3, 1, 0)
         ON CONFLICT ("linkId", "occurredOn", "country")
         DO UPDATE SET "accessCount" = "link_daily_aggregates"."accessCount" + 1`,
        [input.linkId, input.occurredOn, input.country],
      );

      await manager.query(
        `INSERT INTO "link_monthly_aggregates"
          ("linkId", "occurredMonth", "accessCount", "dailyUniqueVisitorCount")
         VALUES ($1, $2, 1, 0)
         ON CONFLICT ("linkId", "occurredMonth")
         DO UPDATE SET "accessCount" = "link_monthly_aggregates"."accessCount" + 1`,
        [input.linkId, occurredMonth],
      );

      const insertedVisitors: Array<{ visitorPseudonym: string }> =
        await manager.query(
          `INSERT INTO "link_daily_visitors"
            ("linkId", "occurredOn", "visitorPseudonym", "country")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("linkId", "occurredOn", "visitorPseudonym") DO NOTHING
           RETURNING "visitorPseudonym"`,
          [
            input.linkId,
            input.occurredOn,
            input.visitorPseudonym,
            input.country,
          ],
        );

      if (insertedVisitors.length === 0) {
        return;
      }

      await manager.query(
        `UPDATE "link_daily_aggregates"
         SET "uniqueVisitorCount" = "uniqueVisitorCount" + 1
         WHERE "linkId" = $1 AND "occurredOn" = $2 AND "country" = $3`,
        [input.linkId, input.occurredOn, input.country],
      );

      await manager.query(
        `UPDATE "link_monthly_aggregates"
         SET "dailyUniqueVisitorCount" = "dailyUniqueVisitorCount" + 1
         WHERE "linkId" = $1 AND "occurredMonth" = $2`,
        [input.linkId, occurredMonth],
      );
    });
  }

  async finalizeDays(before: string): Promise<void> {
    const candidates: LinkDayRow[] = await this.dataSource.query(
      `SELECT days."linkId", days."occurredOn"
       FROM (
         SELECT DISTINCT candidate."linkId", candidate."occurredOn"::text AS "occurredOn"
         FROM (
           SELECT "linkId", "occurredOn" FROM "link_access_events"
           WHERE "occurredOn" < $1
           UNION
           SELECT "linkId", "occurredOn" FROM "link_daily_visitors"
           WHERE "occurredOn" < $1
         ) candidate
         WHERE NOT EXISTS (
           SELECT 1
           FROM "link_statistics_days" finalized
           WHERE finalized."linkId" = candidate."linkId"
             AND finalized."occurredOn" = candidate."occurredOn"
         )
       ) days
       ORDER BY days."occurredOn" ASC, days."linkId" ASC`,
      [before],
    );

    for (const candidate of candidates) {
      const occurredOn = this.toUtcDateString(candidate.occurredOn);

      await this.dataSource.transaction(async (manager) => {
        await this.lockLinkDay(manager, candidate.linkId, occurredOn);

        const existing = await manager.findOne(LinkStatisticsDayEntity, {
          where: {
            linkId: candidate.linkId,
            occurredOn,
          },
        });

        if (!existing) {
          await manager.insert(LinkStatisticsDayEntity, {
            linkId: candidate.linkId,
            occurredOn,
            finalizedAt: new Date(),
          });
        }

        await manager.delete(LinkAccessEventEntity, {
          linkId: candidate.linkId,
          occurredOn,
        });
        await manager.delete(LinkDailyVisitorEntity, {
          linkId: candidate.linkId,
          occurredOn,
        });
      });
    }
  }

  async getReport(
    linkId: string,
    period: StatisticsPeriod,
  ): Promise<LinkStatisticsReport> {
    const dailyRows: Array<{
      occurredOn: string | Date;
      accessCount: string;
      uniqueVisitorCount: string;
    }> = await this.dataSource.query(
      `SELECT "occurredOn"::text AS "occurredOn",
              SUM("accessCount")::text AS "accessCount",
              SUM("uniqueVisitorCount")::text AS "uniqueVisitorCount"
       FROM "link_daily_aggregates"
       WHERE "linkId" = $1
         AND "occurredOn" >= $2
         AND "occurredOn" <= $3
       GROUP BY "occurredOn"
       ORDER BY "occurredOn" ASC`,
      [linkId, period.from, period.to],
    );

    const dailyByDate = new Map(
      dailyRows.map((row) => [
        this.toUtcDateString(row.occurredOn),
        {
          accesses: Number(row.accessCount),
          dailyUniqueVisitors: Number(row.uniqueVisitorCount),
        },
      ]),
    );

    const daily: LinkStatisticsDailyPoint[] = [];
    for (const date of this.eachUtcDate(period.from, period.to)) {
      const point = dailyByDate.get(date);
      daily.push({
        date,
        accesses: point?.accesses ?? 0,
        dailyUniqueVisitors: point?.dailyUniqueVisitors ?? 0,
      });
    }

    const monthFrom = period.from.slice(0, 7);
    const monthTo = period.to.slice(0, 7);
    const monthlyRows: MonthlySumRow[] = await this.dataSource
      .getRepository(LinkMonthlyAggregateEntity)
      .createQueryBuilder('monthly')
      .where('monthly.linkId = :linkId', { linkId })
      .andWhere('monthly.occurredMonth >= :monthFrom', { monthFrom })
      .andWhere('monthly.occurredMonth <= :monthTo', { monthTo })
      .orderBy('monthly.occurredMonth', 'ASC')
      .getMany();

    const monthlyByKey = new Map(
      monthlyRows.map((row) => [
        row.occurredMonth,
        {
          accesses: row.accessCount,
          dailyUniqueVisitors: row.dailyUniqueVisitorCount,
        },
      ]),
    );

    const monthly: LinkStatisticsMonthlyPoint[] = [];
    for (const month of this.eachUtcMonth(monthFrom, monthTo)) {
      const point = monthlyByKey.get(month);
      monthly.push({
        month,
        accesses: point?.accesses ?? 0,
        dailyUniqueVisitors: point?.dailyUniqueVisitors ?? 0,
      });
    }

    const countryRows: CountrySumRow[] = await this.dataSource.query(
      `SELECT "country",
              SUM("accessCount")::text AS "accesses",
              SUM("uniqueVisitorCount")::text AS "dailyUniqueVisitors"
       FROM "link_daily_aggregates"
       WHERE "linkId" = $1
         AND "occurredOn" >= $2
         AND "occurredOn" <= $3
       GROUP BY "country"
       ORDER BY SUM("accessCount") DESC, "country" ASC`,
      [linkId, period.from, period.to],
    );

    const countries: LinkStatisticsCountryPoint[] = countryRows.map((row) => ({
      country: row.country,
      accesses: Number(row.accesses),
      dailyUniqueVisitors: Number(row.dailyUniqueVisitors),
    }));

    const totalsRow: AggregateSumRow[] = await this.dataSource.query(
      `SELECT COALESCE(SUM("accessCount"), 0)::text AS "accesses",
              COALESCE(SUM("uniqueVisitorCount"), 0)::text AS "dailyUniqueVisitors"
       FROM "link_daily_aggregates"
       WHERE "linkId" = $1
         AND "occurredOn" >= $2
         AND "occurredOn" <= $3`,
      [linkId, period.from, period.to],
    );

    return {
      linkId,
      period: {
        from: period.from,
        to: period.to,
        timezone: 'UTC',
      },
      totals: {
        accesses: Number(totalsRow[0]?.accesses ?? 0),
        dailyUniqueVisitors: Number(totalsRow[0]?.dailyUniqueVisitors ?? 0),
      },
      daily,
      monthly,
      countries,
    };
  }

  private async lockLinkDay(
    manager: EntityManager,
    linkId: string,
    occurredOn: string,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [linkId, occurredOn],
    );
  }

  private toUtcDateString(value: string | Date): string {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return value.slice(0, 10);
  }

  private eachUtcDate(from: string, to: string): string[] {
    const dates: string[] = [];
    const cursor = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);

    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates;
  }

  private eachUtcMonth(from: string, to: string): string[] {
    const months: string[] = [];
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth] = to.split('-').map(Number);
    let year = fromYear;
    let month = fromMonth;

    while (year < toYear || (year === toYear && month <= toMonth)) {
      months.push(`${year.toString().padStart(4, '0')}-${month
        .toString()
        .padStart(2, '0')}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    return months;
  }
}
