import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LinksRepository } from '../links/links.repository';
import { LinkStatisticsPeriodQueryDto } from './link-statistics.dto';
import { LinkStatisticsRepository } from './link-statistics.repository';
import {
  LinkStatisticsReport,
  StatisticsPeriod,
} from './link-statistics.types';

const MAX_INCLUSIVE_CALENDAR_MONTHS = 12;
const DEFAULT_PERIOD_DAYS = 30;

@Injectable()
export class LinkStatisticsService {
  constructor(
    private readonly linksRepository: LinksRepository,
    private readonly statisticsRepository: LinkStatisticsRepository,
  ) {}

  async getReport(
    userId: string,
    linkId: string,
    query: LinkStatisticsPeriodQueryDto,
  ): Promise<LinkStatisticsReport> {
    const period = this.resolvePeriod(query);

    const link = await this.linksRepository.findById(linkId);
    if (!link) {
      throw this.linkNotFoundException();
    }
    if (link.userId !== userId) {
      throw this.forbiddenException();
    }

    return this.statisticsRepository.getReport(linkId, period);
  }

  private resolvePeriod(query: LinkStatisticsPeriodQueryDto): StatisticsPeriod {
    const hasFrom = query.from !== undefined;
    const hasTo = query.to !== undefined;

    if (hasFrom !== hasTo) {
      throw this.validationError({
        period: ['Both from and to are required when specifying a period.'],
      });
    }

    if (!hasFrom || !hasTo) {
      const to = this.utcToday();
      return {
        from: this.addUtcDays(to, -(DEFAULT_PERIOD_DAYS - 1)),
        to,
      };
    }

    const from = query.from!;
    const to = query.to!;

    if (
      !this.isValidUtcCalendarDate(from) ||
      !this.isValidUtcCalendarDate(to)
    ) {
      throw this.validationError({
        period: ['from and to must be valid UTC calendar dates (YYYY-MM-DD).'],
      });
    }

    if (from > to) {
      throw this.validationError({
        period: ['from must be less than or equal to to.'],
      });
    }

    if (
      this.inclusiveCalendarMonths(from, to) > MAX_INCLUSIVE_CALENDAR_MONTHS
    ) {
      throw this.validationError({
        period: [
          `The period must span at most ${MAX_INCLUSIVE_CALENDAR_MONTHS} inclusive calendar months.`,
        ],
      });
    }

    return { from, to };
  }

  private inclusiveCalendarMonths(from: string, to: string): number {
    const fromYear = Number(from.slice(0, 4));
    const fromMonth = Number(from.slice(5, 7));
    const toYear = Number(to.slice(0, 4));
    const toMonth = Number(to.slice(5, 7));
    return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
  }

  private isValidUtcCalendarDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  private utcToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private addUtcDays(date: string, days: number): string {
    const cursor = new Date(`${date}T00:00:00.000Z`);
    cursor.setUTCDate(cursor.getUTCDate() + days);
    return cursor.toISOString().slice(0, 10);
  }

  private validationError(
    errors: Record<string, string[]>,
  ): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      errors,
    });
  }

  private linkNotFoundException(): NotFoundException {
    return new NotFoundException({
      code: 'LINK_NOT_FOUND',
      message: 'Link not found.',
    });
  }

  private forbiddenException(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have access to this link.',
    });
  }
}
