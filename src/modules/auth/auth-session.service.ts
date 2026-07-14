import { Injectable } from '@nestjs/common';
import {
  AuthSecurityStorageUnavailableError,
  AuthStateService,
  SessionCacheRecord,
} from './auth-state.service';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthRepository } from './auth.repository';
import { SessionRevocationReason } from './auth.types';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RefreshTokenReuseError extends Error {
  constructor(message = 'Refresh token reuse detected.') {
    super(message);
    this.name = 'RefreshTokenReuseError';
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor(message = 'Refresh token is invalid.') {
    super(message);
    this.name = 'InvalidRefreshTokenError';
  }
}

export type IssuedSessionTokens = {
  accessToken: string;
  expiresIn: number;
  csrfToken: string;
  refreshToken: string;
  sessionId: string;
};

export type AuthPrincipal = {
  userId: string;
  role: string;
  sessionId: string;
};

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly state: AuthStateService,
    private readonly crypto: AuthCryptoService,
  ) {}

  async createSessionAfterLogin(
    userId: string,
    role: string,
  ): Promise<IssuedSessionTokens> {
    const refreshToken = this.crypto.generateRefreshToken();
    const csrfToken = this.crypto.generateCsrfToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const created = await this.repository.createExclusiveSession(userId, {
      refreshTokenHash: this.crypto.hashToken(refreshToken),
      csrfTokenHash: this.crypto.hashToken(csrfToken),
      expiresAt,
    });

    for (const revokedSessionId of created.revokedSessionIds) {
      await this.deleteSessionCacheBestEffort(revokedSessionId);
    }

    await this.state.setSessionCache({
      sessionId: created.session.id,
      userId,
      role,
      expiresAt: created.session.expiresAt,
      active: true,
    });

    return this.issueTokens({
      userId,
      role,
      sessionId: created.session.id,
      refreshToken,
      csrfToken,
    });
  }

  async refresh(refreshToken: string): Promise<IssuedSessionTokens> {
    const tokenHash = this.crypto.hashToken(refreshToken);
    const history =
      await this.repository.findRefreshTokenHistoryByHash(tokenHash);

    if (!history) {
      throw new InvalidRefreshTokenError();
    }

    if (history.usedAt !== null) {
      await this.repository.revokeSession(
        history.sessionId,
        SessionRevocationReason.REFRESH_REUSE,
      );
      await this.state.deleteSessionCache(history.sessionId);
      throw new RefreshTokenReuseError();
    }

    const session = await this.repository.findActiveSessionById(
      history.sessionId,
    );

    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.refreshTokenHash !== tokenHash
    ) {
      throw new InvalidRefreshTokenError();
    }

    const account = await this.repository.findAccountById(session.userId);
    if (!account) {
      throw new InvalidRefreshTokenError();
    }

    const nextRefreshToken = this.crypto.generateRefreshToken();
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const rotated = await this.repository.rotateRefreshToken(session.id, {
      currentTokenHash: tokenHash,
      newTokenHash: this.crypto.hashToken(nextRefreshToken),
      newExpiresAt,
    });

    await this.state.setSessionCache({
      sessionId: rotated.session.id,
      userId: account.id,
      role: account.role,
      expiresAt: rotated.session.expiresAt,
      active: true,
    });

    return this.issueTokens({
      userId: account.id,
      role: account.role,
      sessionId: rotated.session.id,
      refreshToken: nextRefreshToken,
      csrfToken: '',
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.crypto.hashToken(refreshToken);
    const session =
      await this.repository.findSessionByRefreshTokenHash(tokenHash);

    if (!session || session.revokedAt !== null) {
      return;
    }

    await this.repository.revokeSession(
      session.id,
      SessionRevocationReason.LOGOUT,
    );
    await this.state.deleteSessionCache(session.id);
  }

  async validateSession(sessionId: string): Promise<AuthPrincipal | null> {
    const cached = await this.readSessionCache(sessionId);

    if (cached) {
      if (!cached.active || cached.expiresAt <= new Date()) {
        return null;
      }

      return {
        userId: cached.userId,
        role: cached.role,
        sessionId: cached.sessionId,
      };
    }

    const session = await this.repository.findActiveSessionById(sessionId);
    if (!session || session.expiresAt <= new Date()) {
      return null;
    }

    const account = await this.repository.findAccountById(session.userId);
    if (!account) {
      return null;
    }

    const record: SessionCacheRecord = {
      sessionId: session.id,
      userId: account.id,
      role: account.role,
      expiresAt: session.expiresAt,
      active: true,
    };

    try {
      await this.state.setSessionCache(record);
    } catch (error) {
      if (!(error instanceof AuthSecurityStorageUnavailableError)) {
        throw error;
      }
    }

    return {
      userId: account.id,
      role: account.role,
      sessionId: session.id,
    };
  }

  private issueTokens(input: {
    userId: string;
    role: string;
    sessionId: string;
    refreshToken: string;
    csrfToken: string;
  }): IssuedSessionTokens {
    return {
      accessToken: this.crypto.signAccessToken({
        sub: input.userId,
        role: input.role,
        sessionId: input.sessionId,
      }),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      csrfToken: input.csrfToken,
      refreshToken: input.refreshToken,
      sessionId: input.sessionId,
    };
  }

  private async readSessionCache(
    sessionId: string,
  ): Promise<SessionCacheRecord | null | undefined> {
    try {
      return await this.state.getSessionCache(sessionId);
    } catch (error) {
      if (error instanceof AuthSecurityStorageUnavailableError) {
        return undefined;
      }
      throw error;
    }
  }

  private async deleteSessionCacheBestEffort(
    sessionId: string,
  ): Promise<void> {
    try {
      await this.state.deleteSessionCache(sessionId);
    } catch (error) {
      if (!(error instanceof AuthSecurityStorageUnavailableError)) {
        throw error;
      }
    }
  }
}
