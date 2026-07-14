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

  ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    return this.client.eval(script, numKeys, ...args);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
