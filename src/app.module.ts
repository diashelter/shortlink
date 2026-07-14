import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database.module';
import { MailModule } from './mail.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, MailModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
