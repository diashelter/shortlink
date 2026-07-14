const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[^A-Za-z0-9]/;
const MIN_LENGTH = 8;

export class Password {
  private constructor(private readonly raw: string) {}

  static create(raw: string): Password {
    if (!Password.meetsPolicy(raw)) {
      throw new Error('Invalid password.');
    }

    return new Password(raw);
  }

  private static meetsPolicy(raw: string): boolean {
    return (
      raw.length >= MIN_LENGTH &&
      HAS_UPPERCASE.test(raw) &&
      HAS_LOWERCASE.test(raw) &&
      HAS_DIGIT.test(raw) &&
      HAS_SPECIAL.test(raw)
    );
  }

  get value(): string {
    return this.raw;
  }

  toString(): string {
    return this.raw;
  }

  equals(other: Password): boolean {
    return this.raw === other.raw;
  }
}
