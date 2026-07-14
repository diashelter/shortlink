import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AccountEntity } from './account.entity';
import { AccountRole } from './account-role.enum';
import { AccountStatus } from './account-status.enum';
import { AuthRepository } from './auth.repository';
import { AuthSessionEntity } from './auth-session.entity';
import {
  AccountRecord,
  AuthSessionRecord,
  CreateExclusiveSessionInput,
  CreateExclusiveSessionResult,
  CreatePasswordResetTokenInput,
  CreatePendingAccountInput,
  PasswordResetTokenRecord,
  RotateRefreshTokenInput,
  SessionRefreshTokenRecord,
  SessionRevocationReason,
} from './auth.types';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { SessionRefreshTokenEntity } from './session-refresh-token.entity';

@Injectable()
export class TypeormAuthRepository extends AuthRepository {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const account = await this.dataSource
      .getRepository(AccountEntity)
      .findOne({ where: { email } });

    return account ? this.toAccountRecord(account) : null;
  }

  async findAccountById(id: string): Promise<AccountRecord | null> {
    const account = await this.dataSource
      .getRepository(AccountEntity)
      .findOne({ where: { id } });

    return account ? this.toAccountRecord(account) : null;
  }

  async createPendingAccount(
    input: CreatePendingAccountInput,
  ): Promise<AccountRecord> {
    const accounts = this.dataSource.getRepository(AccountEntity);
    const account = await accounts.save(
      accounts.create({
        email: input.email,
        passwordHash: input.passwordHash,
        status: AccountStatus.PENDING,
        role: AccountRole.USER,
      }),
    );

    return this.toAccountRecord(account);
  }

  async activateAccount(userId: string): Promise<AccountRecord> {
    return this.dataSource.transaction(async (manager) => {
      const account = await this.lockAccount(manager, userId);
      account.status = AccountStatus.ACTIVE;
      const saved = await manager.save(account);
      return this.toAccountRecord(saved);
    });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const account = await this.lockAccount(manager, userId);
      account.passwordHash = passwordHash;
      await manager.save(account);
    });
  }

  async createExclusiveSession(
    userId: string,
    sessionData: CreateExclusiveSessionInput,
  ): Promise<CreateExclusiveSessionResult> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockAccount(manager, userId);
      const revokedSessionIds = await this.revokeActiveSessions(
        manager,
        userId,
        SessionRevocationReason.NEW_LOGIN,
      );

      const now = new Date();
      const session = await manager.save(
        manager.create(AuthSessionEntity, {
          userId,
          refreshTokenHash: sessionData.refreshTokenHash,
          csrfTokenHash: sessionData.csrfTokenHash,
          expiresAt: sessionData.expiresAt,
          revokedAt: null,
          revocationReason: null,
          lastRotatedAt: now,
        }),
      );

      const refreshToken = await manager.save(
        manager.create(SessionRefreshTokenEntity, {
          sessionId: session.id,
          tokenHash: sessionData.refreshTokenHash,
          issuedAt: now,
          usedAt: null,
          expiresAt: sessionData.expiresAt,
        }),
      );

      return {
        session: this.toSessionRecord(session),
        refreshToken: this.toRefreshTokenRecord(refreshToken),
        revokedSessionIds,
      };
    });
  }

  async rotateRefreshToken(
    sessionId: string,
    input: RotateRefreshTokenInput,
  ): Promise<CreateExclusiveSessionResult> {
    return this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(AuthSessionEntity, {
        where: { id: sessionId },
      });

      if (!session || session.revokedAt !== null) {
        throw new Error('Session is not active.');
      }

      await this.lockAccount(manager, session.userId);

      const lockedSession = await manager.findOne(AuthSessionEntity, {
        where: { id: sessionId },
      });

      if (!lockedSession || lockedSession.revokedAt !== null) {
        throw new Error('Session is not active.');
      }

      if (lockedSession.refreshTokenHash !== input.currentTokenHash) {
        throw new Error('Current refresh token does not match the session.');
      }

      const currentToken = await manager.findOne(SessionRefreshTokenEntity, {
        where: {
          sessionId,
          tokenHash: input.currentTokenHash,
          usedAt: IsNull(),
        },
      });

      if (!currentToken) {
        throw new Error('Current refresh token is not usable.');
      }

      const now = new Date();
      currentToken.usedAt = now;
      await manager.save(currentToken);

      lockedSession.refreshTokenHash = input.newTokenHash;
      lockedSession.expiresAt = input.newExpiresAt;
      lockedSession.lastRotatedAt = now;
      const savedSession = await manager.save(lockedSession);

      const refreshToken = await manager.save(
        manager.create(SessionRefreshTokenEntity, {
          sessionId,
          tokenHash: input.newTokenHash,
          issuedAt: now,
          usedAt: null,
          expiresAt: input.newExpiresAt,
        }),
      );

      return {
        session: this.toSessionRecord(savedSession),
        refreshToken: this.toRefreshTokenRecord(refreshToken),
        revokedSessionIds: [],
      };
    });
  }

  async revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(AuthSessionEntity, {
        where: { id: sessionId },
      });

      if (!session || session.revokedAt !== null) {
        return;
      }

      await this.lockAccount(manager, session.userId);

      const lockedSession = await manager.findOne(AuthSessionEntity, {
        where: { id: sessionId },
      });

      if (!lockedSession || lockedSession.revokedAt !== null) {
        return;
      }

      lockedSession.revokedAt = new Date();
      lockedSession.revocationReason = reason;
      await manager.save(lockedSession);
    });
  }

  async revokeAllSessions(
    userId: string,
    reason: SessionRevocationReason,
  ): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockAccount(manager, userId);
      return this.revokeActiveSessions(manager, userId, reason);
    });
  }

  async findSessionByRefreshTokenHash(
    hash: string,
  ): Promise<AuthSessionRecord | null> {
    const session = await this.dataSource
      .getRepository(AuthSessionEntity)
      .findOne({ where: { refreshTokenHash: hash } });

    return session ? this.toSessionRecord(session) : null;
  }

  async findActiveSessionById(
    sessionId: string,
  ): Promise<AuthSessionRecord | null> {
    const session = await this.dataSource
      .getRepository(AuthSessionEntity)
      .findOne({ where: { id: sessionId, revokedAt: IsNull() } });

    return session ? this.toSessionRecord(session) : null;
  }

  async findRefreshTokenHistoryByHash(
    hash: string,
  ): Promise<SessionRefreshTokenRecord | null> {
    const token = await this.dataSource
      .getRepository(SessionRefreshTokenEntity)
      .findOne({ where: { tokenHash: hash } });

    return token ? this.toRefreshTokenRecord(token) : null;
  }

  async createPasswordResetToken(
    userId: string,
    input: CreatePasswordResetTokenInput,
  ): Promise<PasswordResetTokenRecord> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockAccount(manager, userId);
      await this.markResetTokensUsed(manager, userId);

      const token = await manager.save(
        manager.create(PasswordResetTokenEntity, {
          userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          usedAt: null,
        }),
      );

      return this.toPasswordResetTokenRecord(token);
    });
  }

  async consumePasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | null> {
    return this.dataSource.transaction(async (manager) => {
      const token = await manager.findOne(PasswordResetTokenEntity, {
        where: { tokenHash },
      });

      if (!token || token.usedAt !== null || token.expiresAt <= new Date()) {
        return null;
      }

      await this.lockAccount(manager, token.userId);

      const lockedToken = await manager.findOne(PasswordResetTokenEntity, {
        where: { tokenHash },
      });

      if (
        !lockedToken ||
        lockedToken.usedAt !== null ||
        lockedToken.expiresAt <= new Date()
      ) {
        return null;
      }

      lockedToken.usedAt = new Date();
      const saved = await manager.save(lockedToken);
      return this.toPasswordResetTokenRecord(saved);
    });
  }

  async invalidatePreviousResetTokens(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.lockAccount(manager, userId);
      await this.markResetTokensUsed(manager, userId);
    });
  }

  private async lockAccount(
    manager: EntityManager,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await manager.findOne(AccountEntity, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!account) {
      throw new Error('Account not found.');
    }

    return account;
  }

  private async revokeActiveSessions(
    manager: EntityManager,
    userId: string,
    reason: SessionRevocationReason,
  ): Promise<string[]> {
    const activeSessions = await manager.find(AuthSessionEntity, {
      where: { userId, revokedAt: IsNull() },
    });

    if (activeSessions.length === 0) {
      return [];
    }

    const now = new Date();
    for (const session of activeSessions) {
      session.revokedAt = now;
      session.revocationReason = reason;
    }

    await manager.save(activeSessions);
    return activeSessions.map((session) => session.id);
  }

  private async markResetTokensUsed(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const tokens = await manager.find(PasswordResetTokenEntity, {
      where: { userId, usedAt: IsNull() },
    });

    if (tokens.length === 0) {
      return;
    }

    const now = new Date();
    for (const token of tokens) {
      token.usedAt = now;
    }

    await manager.save(tokens);
  }

  private toAccountRecord(account: AccountEntity): AccountRecord {
    return {
      id: account.id,
      email: account.email,
      status: account.status,
      role: account.role,
      passwordHash: account.passwordHash,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private toSessionRecord(session: AuthSessionEntity): AuthSessionRecord {
    return {
      id: session.id,
      userId: session.userId,
      refreshTokenHash: session.refreshTokenHash,
      csrfTokenHash: session.csrfTokenHash,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      revocationReason: session.revocationReason,
      createdAt: session.createdAt,
      lastRotatedAt: session.lastRotatedAt,
    };
  }

  private toRefreshTokenRecord(
    token: SessionRefreshTokenEntity,
  ): SessionRefreshTokenRecord {
    return {
      id: token.id,
      sessionId: token.sessionId,
      tokenHash: token.tokenHash,
      issuedAt: token.issuedAt,
      usedAt: token.usedAt,
      expiresAt: token.expiresAt,
    };
  }

  private toPasswordResetTokenRecord(
    token: PasswordResetTokenEntity,
  ): PasswordResetTokenRecord {
    return {
      id: token.id,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      usedAt: token.usedAt,
      createdAt: token.createdAt,
    };
  }
}
