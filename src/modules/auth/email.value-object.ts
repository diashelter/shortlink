const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class Email {
  private constructor(private readonly canonical: string) {}

  static create(raw: string): Email {
    const canonical = raw.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(canonical)) {
      throw new Error('Invalid email.');
    }

    return new Email(canonical);
  }

  get value(): string {
    return this.canonical;
  }

  toString(): string {
    return this.canonical;
  }

  equals(other: Email): boolean {
    return this.canonical === other.canonical;
  }
}
