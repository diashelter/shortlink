import { isIP, isIPv4, isIPv6 } from 'net';
import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';
import {
  CountryCode,
  CountryResolver,
  UNKNOWN_COUNTRY,
} from './country-resolver.service';

type CountryLookupReader = {
  country(ip: string): {
    country?: {
      isoCode?: string;
    };
  };
};

@Injectable()
export class LocalCountryResolver extends CountryResolver {
  private reader: CountryLookupReader | null | undefined = undefined;
  private readonly dbPath: string | undefined;
  private openPromise: Promise<void> | undefined;

  constructor(dbPath?: string | null) {
    super();

    if (arguments.length === 0) {
      this.dbPath = validateEnvironment().geoipCountryDbPath;
    } else {
      this.dbPath = dbPath ?? undefined;
    }
  }

  whenReady(): Promise<void> {
    if (!this.openPromise) {
      this.openPromise = this.openDatabase();
    }
    return this.openPromise;
  }

  resolve(ip: string): CountryCode {
    if (!isUsablePublicIp(ip)) {
      return UNKNOWN_COUNTRY;
    }

    if (!this.reader) {
      return UNKNOWN_COUNTRY;
    }

    try {
      const response = this.reader.country(ip);
      const isoCode = response.country?.isoCode;
      if (typeof isoCode !== 'string' || isoCode.length !== 2) {
        return UNKNOWN_COUNTRY;
      }
      return isoCode;
    } catch {
      return UNKNOWN_COUNTRY;
    }
  }

  private async openDatabase(): Promise<void> {
    if (!this.dbPath) {
      this.reader = null;
      return;
    }

    try {
      // Dynamic import: @maxmind/geoip2-node is ESM-only; Nest compiles to CommonJS.
      // Reader.open reads a local MMDB file only — IP is never sent over the network.
      const { Reader } = await import('@maxmind/geoip2-node');
      this.reader = await Reader.open(this.dbPath);
    } catch {
      this.reader = null;
    }
  }
}

function isUsablePublicIp(ip: string): boolean {
  if (typeof ip !== 'string' || ip.trim().length === 0) {
    return false;
  }

  const trimmed = ip.trim();
  if (isIP(trimmed) === 0) {
    return false;
  }

  return !isPrivateIp(trimmed);
}

function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) {
    return isPrivateIPv4(ip);
  }

  if (isIPv6(ip)) {
    return isPrivateIPv6(ip);
  }

  return true;
}

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number(part));
  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::1' || lower === '::') {
    return true;
  }

  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }

  if (lower.startsWith('fe80:')) {
    return true;
  }

  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (isIPv4(mapped)) {
      return isPrivateIPv4(mapped);
    }
  }

  return false;
}
