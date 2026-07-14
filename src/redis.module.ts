import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { validateEnvironment } from './environment.validation';
import { RedisService } from './redis.service';

export const AUTH_EMAIL_QUEUE = 'auth-email';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const env = validateEnvironment();

        return {
          connection: {
            host: env.redis.host,
            port: env.redis.port,
          },
          defaultJobOptions: {
            attempts: env.emailQueue.attempts,
            backoff: {
              type: 'exponential' as const,
              delay: env.emailQueue.backoffMs,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: AUTH_EMAIL_QUEUE,
    }),
  ],
  providers: [RedisService],
  exports: [RedisService, BullModule],
})
export class RedisModule {}
