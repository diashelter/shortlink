import {
  AccessEventInput,
  LinkStatisticsReport,
  StatisticsPeriod,
} from './link-statistics.types';

export abstract class LinkStatisticsRepository {
  abstract recordAccess(input: AccessEventInput): Promise<void>;

  abstract finalizeDays(before: string): Promise<void>;

  abstract getReport(
    linkId: string,
    period: StatisticsPeriod,
  ): Promise<LinkStatisticsReport>;
}
