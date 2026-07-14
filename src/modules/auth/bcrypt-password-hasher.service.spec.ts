import { BcryptPasswordHasherService } from './bcrypt-password-hasher.service';
import { Password } from './password.value-object';
import { PasswordHash } from './password-hash.value-object';

describe('BcryptPasswordHasherService', () => {
  const hasher = new BcryptPasswordHasherService();
  const password = Password.create('Secret1!');

  it('hashes a password with bcrypt cost 12', async () => {
    const hash = await hasher.hash(password);

    expect(hash).toBeInstanceOf(PasswordHash);
    expect(hash.value).toMatch(/^\$2[aby]\$12\$/);
    expect(hash.value).not.toContain(password.value);
  });

  it('compares a matching password and hash as true', async () => {
    const hash = await hasher.hash(password);

    await expect(hasher.compare(password, hash)).resolves.toBe(true);
  });

  it('compares a non-matching password and hash as false', async () => {
    const hash = await hasher.hash(password);
    const other = Password.create('Other1!x');

    await expect(hasher.compare(other, hash)).resolves.toBe(false);
  });

  it('does not leak the original password in the produced hash', async () => {
    const hash = await hasher.hash(password);

    expect(hash.value).not.toContain(password.value);
    expect(JSON.stringify(hash)).not.toContain(password.value);
  });
});
