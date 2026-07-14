import { NodeAuthCryptoService } from './node-auth-crypto.service';

describe('NodeAuthCryptoService', () => {
  const hmacSecret = 'unit-test-auth-hmac-secret';
  const tokenHashSecret = 'unit-test-auth-token-hash-secret';
  const jwtSecret = 'unit-test-jwt-access-secret';

  let crypto: NodeAuthCryptoService;

  beforeEach(() => {
    crypto = new NodeAuthCryptoService(hmacSecret, tokenHashSecret, jwtSecret);
  });

  it('generates a 6-digit verification code', () => {
    const code = crypto.generateVerificationCode();

    expect(code).toMatch(/^\d{6}$/);
  });

  it('generates opaque secrets for tokens, challenges and CSRF', () => {
    const opaque = crypto.generateOpaqueToken();
    const challengeId = crypto.generateChallengeId();
    const csrf = crypto.generateCsrfToken();
    const refresh = crypto.generateRefreshToken();

    expect(opaque.length).toBeGreaterThanOrEqual(32);
    expect(challengeId.length).toBeGreaterThanOrEqual(32);
    expect(csrf.length).toBeGreaterThanOrEqual(32);
    expect(refresh.length).toBeGreaterThanOrEqual(32);
    expect(new Set([opaque, challengeId, csrf, refresh]).size).toBe(4);
  });

  it('HMACs verification codes with AUTH_HMAC_SECRET', () => {
    const digest = crypto.hmacCode('123456');

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('123456');
    expect(crypto.hmacCode('123456')).toBe(digest);
    expect(crypto.hmacCode('654321')).not.toBe(digest);
  });

  it('hashes opaque tokens with AUTH_TOKEN_HASH_SECRET', () => {
    const token = crypto.generateRefreshToken();
    const digest = crypto.hashToken(token);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain(token);
    expect(crypto.hashToken(token)).toBe(digest);
  });

  it('signs JWT access tokens with sub, role, sessionId, iat and 15-minute exp', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = crypto.signAccessToken({
      sub: 'account-public-id',
      role: 'USER',
      sessionId: 'session-uuid',
    });
    const after = Math.floor(Date.now() / 1000);

    const payload = crypto.verifyAccessToken(token);

    expect(payload.sub).toBe('account-public-id');
    expect(payload.role).toBe('USER');
    expect(payload.sessionId).toBe('session-uuid');
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.exp).toBe(payload.iat + 15 * 60);
  });

  it('rejects tampered or invalid JWT access tokens', () => {
    const token = crypto.signAccessToken({
      sub: 'account-public-id',
      role: 'USER',
      sessionId: 'session-uuid',
    });

    expect(() => crypto.verifyAccessToken(`${token}x`)).toThrow();
    expect(() =>
      new NodeAuthCryptoService(
        hmacSecret,
        tokenHashSecret,
        'other-jwt-secret',
      ).verifyAccessToken(token),
    ).toThrow();
  });
});
