export type AccessTokenClaims = {
  sub: string;
  role: string;
  sessionId: string;
};

export type AccessTokenPayload = AccessTokenClaims & {
  iat: number;
  exp: number;
};

export abstract class AuthCryptoService {
  abstract generateVerificationCode(): string;

  abstract generateOpaqueToken(): string;

  abstract generateChallengeId(): string;

  abstract generateCsrfToken(): string;

  abstract generateRefreshToken(): string;

  abstract hmacCode(code: string): string;

  abstract hashToken(token: string): string;

  abstract signAccessToken(claims: AccessTokenClaims): string;

  abstract verifyAccessToken(token: string): AccessTokenPayload;
}
