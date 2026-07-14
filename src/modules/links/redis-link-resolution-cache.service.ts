import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';
import { RedisService } from '../../redis.service';
import { LinkResolutionCache } from './link-resolution-cache.service';
import { ResolvedLink } from './links.types';

const KEY_PREFIX = 'shortlink:links:resolution:v2:';

@Injectable()
export class RedisLinkResolutionCache extends LinkResolutionCache {
  private readonly ttlSeconds: number;

  constructor(private readonly redis: RedisService) {
    super();
    this.ttlSeconds = validateEnvironment().linkResolutionCacheTtlSeconds;
  }

  async get(shortCode: string): Promise<ResolvedLink | null> {
    const raw = await this.redis.get(this.key(shortCode));
    if (raw === null) {
      return null;
    }

    return this.parseResolvedLink(raw);
  }

  async set(shortCode: string, resolved: ResolvedLink): Promise<void> {
    await this.redis.set(
      this.key(shortCode),
      JSON.stringify(resolved),
      this.ttlSeconds,
    );
  }

  async invalidate(shortCode: string): Promise<void> {
    await this.redis.del(this.key(shortCode));
  }

  private key(shortCode: string): string {
    return `${KEY_PREFIX}${shortCode}`;
  }

  private parseResolvedLink(raw: string): ResolvedLink | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { linkId?: unknown }).linkId !== 'string' ||
        typeof (parsed as { destinationUrl?: unknown }).destinationUrl !==
          'string'
      ) {
        return null;
      }

      return {
        linkId: (parsed as ResolvedLink).linkId,
        destinationUrl: (parsed as ResolvedLink).destinationUrl,
      };
    } catch {
      return null;
    }
  }
}
