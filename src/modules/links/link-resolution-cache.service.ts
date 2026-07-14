export abstract class LinkResolutionCache {
  abstract get(shortCode: string): Promise<string | null>;

  abstract set(shortCode: string, destinationUrl: string): Promise<void>;

  abstract invalidate(shortCode: string): Promise<void>;
}
