import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database.module';
import { EmailProcessor } from './email.processor';
import { MailModule } from './mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { LinkStatisticsFinalizerService } from './modules/link-statistics/link-statistics-finalizer.service';
import { LinkStatisticsModule } from './modules/link-statistics/link-statistics.module';
import { LinkStatisticsProcessor } from './modules/link-statistics/link-statistics.processor';
import { RedisModule } from './redis.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    MailModule,
    AuthModule,
    LinkStatisticsModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    EmailProcessor,
    LinkStatisticsProcessor,
    LinkStatisticsFinalizerService,
  ],
})
export class WorkerModule {}
