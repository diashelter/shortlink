const MAX_CANONICAL_LENGTH = 2048;

export class DestinationUrl {
  private constructor(private readonly canonical: string) {
    Object.freeze(this);
  }

  static create(raw: string): DestinationUrl {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new Error('Invalid destination URL.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid destination URL.');
    }

    if (url.username || url.password) {
      throw new Error('Invalid destination URL.');
    }

    const canonical = url.href;
    if (canonical.length > MAX_CANONICAL_LENGTH) {
      throw new Error('Invalid destination URL.');
    }

    return new DestinationUrl(canonical);
  }

  get value(): string {
    return this.canonical;
  }

  toString(): string {
    return this.canonical;
  }

  equals(other: DestinationUrl): boolean {
    return this.canonical === other.canonical;
  }
}
