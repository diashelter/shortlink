import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';
import { RedisService } from '../../redis.service';
import { LinkResolutionCache } from './link-resolution-cache.service';

const KEY_PREFIX = 'shortlink:links:resolution:';

@Injectable()
export class RedisLinkResolutionCache extends LinkResolutionCache {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    ttlSeconds?: number,
  ) {
    super();
    this.ttlSeconds =
      ttlSeconds ?? validateEnvironment().linkResolutionCacheTtlSeconds;
  }

  async get(shortCode: string): Promise<string | null> {
    return this.redis.get(this.key(shortCode));
  }

  async set(shortCode: string, destinationUrl: string): Promise<void> {
    await this.redis.set(this.key(shortCode), destinationUrl, this.ttlSeconds);
  }

  async invalidate(shortCode: string): Promise<void> {
    await this.redis.del(this.key(shortCode));
  }

  private key(shortCode: string): string {
    return `${KEY_PREFIX}${shortCode}`;
  }
}
