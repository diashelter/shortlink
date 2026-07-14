import { DestinationUrl } from './destination-url.value-object';

describe('DestinationUrl', () => {
  it('accepts absolute HTTP and HTTPS URLs', () => {
    expect(DestinationUrl.create('https://example.com/path').value).toBe(
      'https://example.com/path',
    );
    expect(DestinationUrl.create('http://example.com/path').value).toBe(
      'http://example.com/path',
    );
  });

  it('canonicalizes scheme and host via the URL API', () => {
    const first = DestinationUrl.create('HTTPS://Example.COM:443/a?b=1#frag');
    const second = DestinationUrl.create('https://example.com/a?b=1#frag');

    expect(first.value).toBe('https://example.com/a?b=1#frag');
    expect(first.equals(second)).toBe(true);
  });

  it('preserves path, query string, and fragment', () => {
    const url = DestinationUrl.create(
      'https://example.com/path/to?x=1&y=2#section',
    );

    expect(url.value).toBe('https://example.com/path/to?x=1&y=2#section');
  });

  it('rejects non-absolute and unsupported schemes', () => {
    expect(() => DestinationUrl.create('example.com')).toThrow(/Invalid/);
    expect(() => DestinationUrl.create('/relative')).toThrow(/Invalid/);
    expect(() => DestinationUrl.create('ftp://example.com')).toThrow(/Invalid/);
    expect(() => DestinationUrl.create('javascript:alert(1)')).toThrow(
      /Invalid/,
    );
  });

  it('rejects embedded credentials', () => {
    expect(() =>
      DestinationUrl.create('https://user:pass@example.com/path'),
    ).toThrow(/Invalid/);
  });

  it('rejects canonical values longer than 2048 characters', () => {
    const longPath = 'a'.repeat(2040);
    const raw = `https://example.com/${longPath}`;

    expect(raw.length).toBeGreaterThan(2048);
    expect(() => DestinationUrl.create(raw)).toThrow(/Invalid/);
  });

  it('is immutable after creation', () => {
    const url = DestinationUrl.create('https://example.com/path');

    expect(Object.isFrozen(url)).toBe(true);
    expect(url.value).toBe('https://example.com/path');
  });
});
