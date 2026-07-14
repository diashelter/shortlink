import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { EmailProcessor } from './email.processor';
import { MailModule } from './mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, MailModule, AuthModule],
  providers: [EmailProcessor],
})
export class WorkerModule {}
