import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { validateEnvironment } from '../../environment.validation';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthRepository } from './auth.repository';
import { AuthSessionRecord } from './auth.types';

type CsrfOriginRequest = {
  headers: {
    origin?: string;
    referer?: string;
    cookie?: string;
    'x-csrf-token'?: string | string[];
  };
  cookies?: Record<string, string | undefined>;
};

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  private readonly refreshCookieName: string;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly authCrypto: AuthCryptoService,
  ) {
    this.refreshCookieName =
      process.env.REFRESH_COOKIE_NAME?.trim() || 'shortlink_refresh';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedOrigins = validateEnvironment().corsAllowedOrigins;
    const request = context.switchToHttp().getRequest<CsrfOriginRequest>();
    const csrfHeader = request.headers['x-csrf-token'];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (!csrfToken?.trim()) {
      throw this.csrfFailed();
    }

    const origin = this.resolveOrigin(
      request.headers.origin,
      request.headers.referer,
    );

    if (!origin || !allowedOrigins.includes(origin)) {
      throw this.csrfFailed();
    }

    const refreshToken = this.readRefreshCookie(request);
    if (!refreshToken) {
      throw this.csrfFailed();
    }

    const session = await this.resolveSession(refreshToken);
    if (
      !session ||
      !this.hashesMatch(
        this.authCrypto.hashToken(csrfToken),
        session.csrfTokenHash,
      )
    ) {
      throw this.csrfFailed();
    }

    return true;
  }

  private async resolveSession(
    refreshToken: string,
  ): Promise<AuthSessionRecord | null> {
    const tokenHash = this.authCrypto.hashToken(refreshToken);
    const byCurrentHash =
      await this.authRepository.findSessionByRefreshTokenHash(tokenHash);
    if (byCurrentHash) {
      return byCurrentHash;
    }

    const history =
      await this.authRepository.findRefreshTokenHistoryByHash(tokenHash);
    if (!history) {
      return null;
    }

    return this.authRepository.findActiveSessionById(history.sessionId);
  }

  private readRefreshCookie(request: CsrfOriginRequest): string | null {
    const fromParser = request.cookies?.[this.refreshCookieName];
    if (typeof fromParser === 'string' && fromParser.length > 0) {
      return fromParser;
    }

    const rawCookie = request.headers.cookie;
    if (!rawCookie) {
      return null;
    }

    const prefix = `${this.refreshCookieName}=`;
    for (const part of rawCookie.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        const value = trimmed.slice(prefix.length);
        return value.length > 0 ? decodeURIComponent(value) : null;
      }
    }

    return null;
  }

  private resolveOrigin(
    origin: string | undefined,
    referer: string | undefined,
  ): string | null {
    if (origin?.trim()) {
      return origin.trim();
    }

    if (!referer?.trim()) {
      return null;
    }

    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  private hashesMatch(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left);
    const rightBuf = Buffer.from(right);
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  }

  private csrfFailed(): ForbiddenException {
    return new ForbiddenException({
      code: 'CSRF_VALIDATION_FAILED',
      message: 'CSRF validation failed.',
    });
  }
}
