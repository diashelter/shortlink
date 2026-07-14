import * as crypto from 'crypto';
import { NodeLinkCodeGenerator } from './node-link-code-generator.service';

jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomInt: jest.fn(actual.randomInt),
  };
});

const mockedRandomInt = crypto.randomInt as unknown as jest.Mock;

describe('NodeLinkCodeGenerator', () => {
  const generator = new NodeLinkCodeGenerator();

  beforeEach(() => {
    mockedRandomInt.mockReset();
    mockedRandomInt.mockImplementation(
      jest.requireActual<typeof import('crypto')>('crypto').randomInt,
    );
  });

  it('generates exactly six uppercase alphanumeric characters', () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(generator.generate()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('uses cryptographically secure randomInt for each character', () => {
    mockedRandomInt.mockReturnValue(0);

    const code = generator.generate();

    expect(code).toBe('AAAAAA');
    expect(mockedRandomInt).toHaveBeenCalledTimes(6);
    expect(mockedRandomInt).toHaveBeenCalledWith(36);
  });

  it('does not produce identical values across many generations', () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generator.generate()),
    );

    expect(codes.size).toBeGreaterThan(90);
  });
});
