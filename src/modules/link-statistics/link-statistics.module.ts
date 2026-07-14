import { Module } from '@nestjs/common';
import { LinkStatisticsRepository } from './link-statistics.repository';
import { TypeormLinkStatisticsRepository } from './typeorm-link-statistics.repository';

@Module({
  providers: [
    {
      provide: LinkStatisticsRepository,
      useClass: TypeormLinkStatisticsRepository,
    },
  ],
  exports: [LinkStatisticsRepository],
})
export class LinkStatisticsModule {}
