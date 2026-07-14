import { Email } from './email.value-object';

describe('Email', () => {
  describe('create', () => {
    it('trims surrounding whitespace and lowercases the value', () => {
      const email = Email.create('  User.Name+Tag@Example.COM  ');

      expect(email.value).toBe('user.name+tag@example.com');
      expect(email.toString()).toBe('user.name+tag@example.com');
    });

    it('treats emails with the same canonical value as equal', () => {
      const left = Email.create('  Alice@Example.Com ');
      const right = Email.create('alice@example.com');

      expect(left.equals(right)).toBe(true);
      expect(right.equals(left)).toBe(true);
    });

    it('treats emails with different canonical values as not equal', () => {
      const left = Email.create('alice@example.com');
      const right = Email.create('bob@example.com');

      expect(left.equals(right)).toBe(false);
    });

    it.each([
      '',
      '   ',
      'not-an-email',
      '@example.com',
      'user@',
      'user@localhost',
      'user@@example.com',
      'user@example',
      'user name@example.com',
      'user@exam ple.com',
    ])('rejects invalid email %j with a generic message', (raw) => {
      expect(() => Email.create(raw)).toThrow('Invalid email.');
    });

    it('does not include the raw input in the error message', () => {
      const raw = 'secret-leak@bad';

      expect(() => Email.create(raw)).toThrow('Invalid email.');
      try {
        Email.create(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(raw);
      }
    });
  });
});
