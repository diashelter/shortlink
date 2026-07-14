import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LinkStatisticsRepository } from './link-statistics.repository';

@Injectable()
export class LinkStatisticsFinalizerService {
  constructor(
    private readonly linkStatistics: LinkStatisticsRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'UTC' })
  async finalizePreviousUtcDays(): Promise<void> {
    const todayUtc = new Date().toISOString().slice(0, 10);
    await this.linkStatistics.finalizeDays(todayUtc);
  }
}
