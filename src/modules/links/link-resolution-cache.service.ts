import { ResolvedLink } from './links.types';

export abstract class LinkResolutionCache {
  abstract get(shortCode: string): Promise<ResolvedLink | null>;

  abstract set(shortCode: string, resolved: ResolvedLink): Promise<void>;

  abstract invalidate(shortCode: string): Promise<void>;
}
