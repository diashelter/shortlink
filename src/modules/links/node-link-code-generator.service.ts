import { randomInt } from 'crypto';
import { LinkCodeGenerator } from './link-code-generator.service';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

export class NodeLinkCodeGenerator extends LinkCodeGenerator {
  generate(): string {
    let code = '';

    for (let index = 0; index < CODE_LENGTH; index += 1) {
      code += ALPHABET[randomInt(ALPHABET.length)];
    }

    return code;
  }
}
