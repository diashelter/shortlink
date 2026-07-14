import { PasswordHash } from './password-hash.value-object';

describe('PasswordHash', () => {
  const validHash =
    '$2b$12$8.Mqyof.PBfeAt7Wjc/XpehvNvRDehBE0BzvPUE8Xf19RLT0/7Tiu';
  const otherHash =
    '$2b$12$FvuabQaHln4GHBg/xeYA0ulbYvPvLFvybWWZYul2zmBXW/o7qwDNG';

  describe('create', () => {
    it('accepts a well-formed bcrypt hash', () => {
      const passwordHash = PasswordHash.create(validHash);

      expect(passwordHash.value).toBe(validHash);
      expect(passwordHash.toString()).toBe(validHash);
    });

    it('treats hashes with the same value as equal', () => {
      const left = PasswordHash.create(validHash);
      const right = PasswordHash.create(validHash);

      expect(left.equals(right)).toBe(true);
    });

    it('treats hashes with different values as not equal', () => {
      const left = PasswordHash.create(validHash);
      const right = PasswordHash.create(otherHash);

      expect(left.equals(right)).toBe(false);
    });

    it('is immutable after creation', () => {
      const passwordHash = PasswordHash.create(validHash);

      expect(() => {
        (passwordHash as { value: string }).value = 'mutated';
      }).toThrow();
      expect(passwordHash.value).toBe(validHash);
    });

    it.each([
      '',
      'plaintext-password',
      '$2b$12$tooshort',
      '$1$12$8.Mqyof.PBfeAt7Wjc/XpehvNvRDehBE0BzvPUE8Xf19RLT0/7Tiu',
      '  $2b$12$8.Mqyof.PBfeAt7Wjc/XpehvNvRDehBE0BzvPUE8Xf19RLT0/7Tiu',
    ])('rejects invalid hash %j with a generic message', (raw) => {
      expect(() => PasswordHash.create(raw)).toThrow('Invalid password hash.');
    });
  });
});
