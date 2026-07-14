import {
  AuthSecurityStorageUnavailableError,
  AuthStateService,
  SessionCacheRecord,
} from './auth-state.service';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthRepository } from './auth.repository';
import {
  AccountRecord,
  AuthSessionRecord,
  SessionRefreshTokenRecord,
  SessionRevocationReason,
} from './auth.types';
import { AccountRole } from './account-role.enum';
import { AccountStatus } from './account-status.enum';
import {
  AuthSessionService,
  RefreshTokenReuseError,
} from './auth-session.service';

describe('AuthSessionService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let repository: jest.Mocked<AuthRepository>;
  let state: jest.Mocked<AuthStateService>;
  let crypto: jest.Mocked<AuthCryptoService>;
  let service: AuthSessionService;

  const account: AccountRecord = {
    id: userId,
    email: 'user@example.com',
    status: AccountStatus.ACTIVE,
    role: AccountRole.USER,
    passwordHash: 'hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const session: AuthSessionRecord = {
    id: sessionId,
    userId,
    refreshTokenHash: 'refresh-hash',
    csrfTokenHash: 'csrf-hash',
    expiresAt,
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date(),
    lastRotatedAt: new Date(),
  };

  beforeEach(() => {
    repository = {
      findAccountByEmail: jest.fn(),
      findAccountById: jest.fn(),
      createPendingAccount: jest.fn(),
      activateAccount: jest.fn(),
      updatePasswordHash: jest.fn(),
      createExclusiveSession: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessions: jest.fn(),
      findSessionByRefreshTokenHash: jest.fn(),
      findActiveSessionById: jest.fn(),
      findRefreshTokenHistoryByHash: jest.fn(),
      createPasswordResetToken: jest.fn(),
      consumePasswordResetToken: jest.fn(),
      invalidatePreviousResetTokens: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;

    state = {
      setActivationCode: jest.fn(),
      consumeActivationCode: jest.fn(),
      setIssuance: jest.fn(),
      isCurrentIssuance: jest.fn(),
      createLoginChallenge: jest.fn(),
      consumeLoginChallenge: jest.fn(),
      setResendCooldown: jest.fn(),
      isResendCooldownActive: jest.fn(),
      incrementRateLimit: jest.fn(),
      getRateLimitCount: jest.fn(),
      incrementFailedLogin: jest.fn(),
      isLoginLocked: jest.fn(),
      setSessionCache: jest.fn(),
      getSessionCache: jest.fn(),
      deleteSessionCache: jest.fn(),
    } as unknown as jest.Mocked<AuthStateService>;

    crypto = {
      generateVerificationCode: jest.fn(),
      generateOpaqueToken: jest.fn(),
      generateChallengeId: jest.fn(),
      generateCsrfToken: jest.fn().mockReturnValue('csrf-raw'),
      generateRefreshToken: jest.fn().mockReturnValue('refresh-raw'),
      hmacCode: jest.fn(),
      hashToken: jest.fn((token: string) => `${token}-hash`),
      signAccessToken: jest.fn().mockReturnValue('access.jwt'),
      verifyAccessToken: jest.fn(),
    } as unknown as jest.Mocked<AuthCryptoService>;

    service = new AuthSessionService(repository, state, crypto);
  });

  it('creates an exclusive session, caches it and issues JWT plus CSRF', async () => {
    repository.createExclusiveSession.mockResolvedValue({
      session,
      refreshToken: {
        id: 'rt-1',
        sessionId,
        tokenHash: 'refresh-raw-hash',
        issuedAt: new Date(),
        usedAt: null,
        expiresAt,
      },
      revokedSessionIds: ['old-session'],
    });

    const result = await service.createSessionAfterLogin(
      userId,
      AccountRole.USER,
    );

    expect(repository.createExclusiveSession).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        refreshTokenHash: 'refresh-raw-hash',
        csrfTokenHash: 'csrf-raw-hash',
      }),
    );
    expect(state.deleteSessionCache).toHaveBeenCalledWith('old-session');
    expect(state.setSessionCache).toHaveBeenCalledWith({
      sessionId,
      userId,
      role: AccountRole.USER,
      expiresAt,
      active: true,
    });
    expect(crypto.signAccessToken).toHaveBeenCalledWith({
      sub: userId,
      role: AccountRole.USER,
      sessionId,
    });
    expect(result).toEqual({
      accessToken: 'access.jwt',
      expiresIn: 15 * 60,
      csrfToken: 'csrf-raw',
      refreshToken: 'refresh-raw',
      sessionId,
    });
  });

  it('validates from cache when the session entry is active', async () => {
    state.getSessionCache.mockResolvedValue({
      sessionId,
      userId,
      role: AccountRole.USER,
      expiresAt,
      active: true,
    });

    await expect(service.validateSession(sessionId)).resolves.toEqual({
      userId,
      role: AccountRole.USER,
      sessionId,
    });
    expect(repository.findActiveSessionById).not.toHaveBeenCalled();
  });

  it('falls back to PostgreSQL and repopulates cache on cache miss', async () => {
    state.getSessionCache.mockResolvedValue(null);
    repository.findActiveSessionById.mockResolvedValue(session);
    repository.findAccountById.mockResolvedValue(account);

    await expect(service.validateSession(sessionId)).resolves.toEqual({
      userId,
      role: AccountRole.USER,
      sessionId,
    });
    expect(state.setSessionCache).toHaveBeenCalledWith({
      sessionId,
      userId,
      role: AccountRole.USER,
      expiresAt,
      active: true,
    });
  });

  it('falls back to PostgreSQL when Redis is unavailable and still tries to repopulate', async () => {
    state.getSessionCache.mockRejectedValue(
      new AuthSecurityStorageUnavailableError(),
    );
    repository.findActiveSessionById.mockResolvedValue(session);
    repository.findAccountById.mockResolvedValue(account);
    state.setSessionCache.mockRejectedValue(
      new AuthSecurityStorageUnavailableError(),
    );

    await expect(service.validateSession(sessionId)).resolves.toEqual({
      userId,
      role: AccountRole.USER,
      sessionId,
    });
    expect(state.setSessionCache).toHaveBeenCalled();
  });

  it('rotates refresh tokens and updates the session cache', async () => {
    const history: SessionRefreshTokenRecord = {
      id: 'rt-1',
      sessionId,
      tokenHash: 'refresh-raw-hash',
      issuedAt: new Date(),
      usedAt: null,
      expiresAt,
    };
    const activeSession = {
      ...session,
      refreshTokenHash: 'refresh-raw-hash',
    };
    const rotatedSession = {
      ...activeSession,
      refreshTokenHash: 'refresh-next-hash',
      expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    };

    crypto.generateRefreshToken.mockReturnValue('refresh-next');
    repository.findRefreshTokenHistoryByHash.mockResolvedValue(history);
    repository.findActiveSessionById.mockResolvedValue(activeSession);
    repository.findAccountById.mockResolvedValue(account);
    repository.rotateRefreshToken.mockResolvedValue({
      session: rotatedSession,
      refreshToken: {
        id: 'rt-2',
        sessionId,
        tokenHash: 'refresh-next-hash',
        issuedAt: new Date(),
        usedAt: null,
        expiresAt: rotatedSession.expiresAt,
      },
      revokedSessionIds: [],
    });

    const result = await service.refresh('refresh-raw');

    expect(repository.rotateRefreshToken).toHaveBeenCalledWith(sessionId, {
      currentTokenHash: 'refresh-raw-hash',
      newTokenHash: 'refresh-next-hash',
      newExpiresAt: expect.any(Date),
    });
    expect(state.setSessionCache).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        active: true,
        expiresAt: rotatedSession.expiresAt,
      } satisfies Partial<SessionCacheRecord>),
    );
    expect(result.refreshToken).toBe('refresh-next');
    expect(result.accessToken).toBe('access.jwt');
  });

  it('revokes the session immediately when a refresh token is reused', async () => {
    repository.findRefreshTokenHistoryByHash.mockResolvedValue({
      id: 'rt-old',
      sessionId,
      tokenHash: 'refresh-raw-hash',
      issuedAt: new Date(),
      usedAt: new Date(),
      expiresAt,
    });

    await expect(service.refresh('refresh-raw')).rejects.toBeInstanceOf(
      RefreshTokenReuseError,
    );
    expect(repository.revokeSession).toHaveBeenCalledWith(
      sessionId,
      SessionRevocationReason.REFRESH_REUSE,
    );
    expect(state.deleteSessionCache).toHaveBeenCalledWith(sessionId);
    expect(repository.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('revokes the session and deletes cache on logout', async () => {
    repository.findSessionByRefreshTokenHash.mockResolvedValue(session);

    await service.logout('refresh-raw');

    expect(repository.revokeSession).toHaveBeenCalledWith(
      sessionId,
      SessionRevocationReason.LOGOUT,
    );
    expect(state.deleteSessionCache).toHaveBeenCalledWith(sessionId);
  });

  it('rejects validation when the PostgreSQL session is revoked', async () => {
    state.getSessionCache.mockResolvedValue(null);
    repository.findActiveSessionById.mockResolvedValue(null);

    await expect(service.validateSession(sessionId)).resolves.toBeNull();
  });
});
