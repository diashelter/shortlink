import { IsOptional, Matches } from 'class-validator';

const UTC_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LinkStatisticsPeriodQueryDto {
  @IsOptional()
  @Matches(UTC_DATE, {
    message: 'from must be a UTC calendar date in YYYY-MM-DD format',
  })
  from?: string;

  @IsOptional()
  @Matches(UTC_DATE, {
    message: 'to must be a UTC calendar date in YYYY-MM-DD format',
  })
  to?: string;
}
