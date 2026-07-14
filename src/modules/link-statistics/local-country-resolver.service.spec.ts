jest.mock('@maxmind/geoip2-node', () => ({
  Reader: {
    open: jest.fn(),
    openBuffer: jest.fn(),
  },
}));

import { Reader } from '@maxmind/geoip2-node';
import { LocalCountryResolver } from './local-country-resolver.service';

describe('LocalCountryResolver', () => {
  const samplePublicIp = '203.0.113.50';
  const samplePrivateIp = '192.168.0.10';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Unknown when the MMDB path is undefined', async () => {
    const resolver = new LocalCountryResolver(null);
    await resolver.whenReady();

    expect(resolver.resolve(samplePublicIp)).toBe('Unknown');
    expect(Reader.open).not.toHaveBeenCalled();
  });

  it('returns Unknown for an invalid IP without querying the reader', async () => {
    const country = jest.fn();
    (Reader.open as jest.Mock).mockResolvedValue({ country });

    const resolver = new LocalCountryResolver(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
    await resolver.whenReady();

    expect(resolver.resolve('not-an-ip')).toBe('Unknown');
    expect(country).not.toHaveBeenCalled();
  });

  it('returns Unknown for a private IP without looking up the database', async () => {
    const country = jest.fn();
    (Reader.open as jest.Mock).mockResolvedValue({ country });

    const resolver = new LocalCountryResolver(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
    await resolver.whenReady();

    expect(resolver.resolve(samplePrivateIp)).toBe('Unknown');
    expect(country).not.toHaveBeenCalled();
  });

  it('returns Unknown when opening the MMDB fails', async () => {
    (Reader.open as jest.Mock).mockRejectedValue(new Error('open failed'));

    const resolver = new LocalCountryResolver('/data/geoip/missing.mmdb');
    await resolver.whenReady();

    expect(resolver.resolve(samplePublicIp)).toBe('Unknown');
  });

  it('returns the ISO country code from a successful local lookup', async () => {
    (Reader.open as jest.Mock).mockResolvedValue({
      country: () => ({ country: { isoCode: 'BR' } }),
    });

    const resolver = new LocalCountryResolver(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
    await resolver.whenReady();

    expect(resolver.resolve(samplePublicIp)).toBe('BR');
    expect(Reader.open).toHaveBeenCalledWith(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
  });

  it('returns Unknown when the database has no match', async () => {
    (Reader.open as jest.Mock).mockResolvedValue({
      country: () => {
        throw new Error('AddressNotFoundError');
      },
    });

    const resolver = new LocalCountryResolver(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
    await resolver.whenReady();

    expect(resolver.resolve(samplePublicIp)).toBe('Unknown');
  });

  it('returns Unknown when the lookup result has no country code', async () => {
    (Reader.open as jest.Mock).mockResolvedValue({
      country: () => ({ country: undefined }),
    });

    const resolver = new LocalCountryResolver(
      '/data/geoip/GeoLite2-Country.mmdb',
    );
    await resolver.whenReady();

    expect(resolver.resolve(samplePublicIp)).toBe('Unknown');
  });
});
