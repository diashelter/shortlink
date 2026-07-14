import { Password } from './password.value-object';

describe('Password', () => {
  const validRaw = 'Secret1!';

  describe('create', () => {
    it('preserves the value exactly as received without trimming', () => {
      const withSpaces = '  Secret1!  ';
      const password = Password.create(withSpaces);

      expect(password.value).toBe(withSpaces);
      expect(password.toString()).toBe(withSpaces);
    });

    it('accepts a password that meets the strength policy', () => {
      const password = Password.create(validRaw);

      expect(password.value).toBe(validRaw);
    });

    it('treats passwords with the same raw value as equal', () => {
      const left = Password.create(validRaw);
      const right = Password.create(validRaw);

      expect(left.equals(right)).toBe(true);
      expect(right.equals(left)).toBe(true);
    });

    it('treats passwords with different raw values as not equal', () => {
      const left = Password.create(validRaw);
      const right = Password.create('Secret2!');

      expect(left.equals(right)).toBe(false);
    });

    it('is immutable after creation', () => {
      const password = Password.create(validRaw);

      expect(() => {
        (password as { value: string }).value = 'Mutated1!';
      }).toThrow();
      expect(password.value).toBe(validRaw);
    });

    it.each([
      '',
      'short1!',
      'nouppercase1!',
      'NOLOWERCASE1!',
      'NoDigits!!',
      'NoSpecial1',
      '       ',
    ])('rejects weak password %j with a generic message', (raw) => {
      expect(() => Password.create(raw)).toThrow('Invalid password.');
    });

    it('does not include the raw password in the error message', () => {
      const raw = 'leaked-secret';

      expect(() => Password.create(raw)).toThrow('Invalid password.');
      try {
        Password.create(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(raw);
      }
    });
  });
});
