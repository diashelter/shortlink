// bcrypt: $2a$|$2b$|$2y$ + cost + 22-char salt + 31-char hash (60 chars total)
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export class PasswordHash {
  private constructor(private readonly hash: string) {}

  static create(hash: string): PasswordHash {
    if (!BCRYPT_HASH_PATTERN.test(hash)) {
      throw new Error('Invalid password hash.');
    }

    return new PasswordHash(hash);
  }

  get value(): string {
    return this.hash;
  }

  toString(): string {
    return this.hash;
  }

  equals(other: PasswordHash): boolean {
    return this.hash === other.hash;
  }
}
