import { Password } from './password.value-object';
import { PasswordHash } from './password-hash.value-object';

export abstract class PasswordHasherService {
  abstract hash(password: Password): Promise<PasswordHash>;
  abstract compare(password: Password, hash: PasswordHash): Promise<boolean>;
}
