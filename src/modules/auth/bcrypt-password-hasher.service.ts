import * as bcrypt from 'bcrypt';
import { PasswordHasherService } from './password-hasher.service';
import { Password } from './password.value-object';
import { PasswordHash } from './password-hash.value-object';

const BCRYPT_COST = 12;

export class BcryptPasswordHasherService extends PasswordHasherService {
  async hash(password: Password): Promise<PasswordHash> {
    const hash = await bcrypt.hash(password.value, BCRYPT_COST);
    return PasswordHash.create(hash);
  }

  async compare(password: Password, hash: PasswordHash): Promise<boolean> {
    return bcrypt.compare(password.value, hash.value);
  }
}
