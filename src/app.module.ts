import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database.module';
import { MailModule } from './mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { LinkStatisticsModule } from './modules/link-statistics/link-statistics.module';
import { LinksModule } from './modules/links/links.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [
    DatabaseModule,
    RedisModule,
    MailModule,
    AuthModule,
    LinksModule,
    LinkStatisticsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
