import { createHmac, randomBytes, randomInt, randomUUID } from 'crypto';
import { sign, verify } from 'jsonwebtoken';
import {
  AccessTokenClaims,
  AccessTokenPayload,
  AuthCryptoService,
} from './auth-crypto.service';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const OPAQUE_TOKEN_BYTES = 32;

export class NodeAuthCryptoService extends AuthCryptoService {
  constructor(
    private readonly hmacSecret: string,
    private readonly tokenHashSecret: string,
    private readonly jwtAccessSecret: string,
  ) {
    super();
  }

  generateVerificationCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  generateOpaqueToken(): string {
    return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
  }

  generateChallengeId(): string {
    return randomUUID();
  }

  generateCsrfToken(): string {
    return this.generateOpaqueToken();
  }

  generateRefreshToken(): string {
    return this.generateOpaqueToken();
  }

  hmacCode(code: string): string {
    return createHmac('sha256', this.hmacSecret).update(code).digest('hex');
  }

  hashToken(token: string): string {
    return createHmac('sha256', this.tokenHashSecret)
      .update(token)
      .digest('hex');
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return sign(
      {
        sub: claims.sub,
        role: claims.role,
        sessionId: claims.sessionId,
      },
      this.jwtAccessSecret,
      {
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = verify(token, this.jwtAccessSecret);

    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid access token payload.');
    }

    const { sub, role, sessionId, iat, exp } = payload as Record<
      string,
      unknown
    >;

    if (
      typeof sub !== 'string' ||
      typeof role !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof iat !== 'number' ||
      typeof exp !== 'number'
    ) {
      throw new Error('Access token claims are incomplete.');
    }

    return { sub, role, sessionId, iat, exp };
  }
}
