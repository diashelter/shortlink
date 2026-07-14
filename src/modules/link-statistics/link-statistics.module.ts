import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis.module';
import { AuthModule } from '../auth/auth.module';
import { LinksModule } from '../links/links.module';
import { AutomatedTrafficDetector } from './automated-traffic-detector.service';
import { CountryResolver } from './country-resolver.service';
import { LinkAccessCollector } from './link-access-collector.service';
import { LinkStatisticsController } from './link-statistics.controller';
import { LinkStatisticsRepository } from './link-statistics.repository';
import { LinkStatisticsService } from './link-statistics.service';
import { LocalCountryResolver } from './local-country-resolver.service';
import { QueueLinkAccessCollector } from './queue-link-access-collector.service';
import { TypeormLinkStatisticsRepository } from './typeorm-link-statistics.repository';
import { VisitorPseudonymizer } from './visitor-pseudonymizer.service';

/**
 * Shared statistics providers for API and worker.
 * Processor, finalizer, and ScheduleModule stay on WorkerModule only.
 */
@Module({
  imports: [RedisModule, AuthModule, LinksModule],
  controllers: [LinkStatisticsController],
  providers: [
    {
      provide: LinkStatisticsRepository,
      useClass: TypeormLinkStatisticsRepository,
    },
    LinkStatisticsService,
    AutomatedTrafficDetector,
    {
      provide: VisitorPseudonymizer,
      useFactory: () => new VisitorPseudonymizer(),
    },
    {
      provide: LocalCountryResolver,
      useFactory: () => new LocalCountryResolver(),
    },
    {
      provide: CountryResolver,
      useExisting: LocalCountryResolver,
    },
    QueueLinkAccessCollector,
    {
      provide: LinkAccessCollector,
      useExisting: QueueLinkAccessCollector,
    },
  ],
  exports: [
    LinkStatisticsRepository,
    AutomatedTrafficDetector,
    VisitorPseudonymizer,
    CountryResolver,
    LinkAccessCollector,
  ],
})
export class LinkStatisticsModule {}
