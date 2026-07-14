import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { validateEnvironment } from './environment.validation';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor() {
    const env = validateEnvironment();
    this.client = new Redis({
      host: env.redis.host,
      port: env.redis.port,
      lazyConnect: false,
    });
  }

  getClient(): Redis {
    return this.client;
  }

  ping(): Promise<string> {
    return this.client.ping();
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    if (ttlSeconds !== undefined) {
      return this.client.set(key, value, 'EX', ttlSeconds);
    }

    return this.client.set(key, value);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
