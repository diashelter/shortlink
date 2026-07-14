export type CountryCode = string;

export const UNKNOWN_COUNTRY = 'Unknown' as const;

export abstract class CountryResolver {
  abstract resolve(ip: string): CountryCode;
}
