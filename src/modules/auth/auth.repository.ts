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

export abstract class AuthRepository {
  abstract findAccountByEmail(email: string): Promise<AccountRecord | null>;

  abstract findAccountById(id: string): Promise<AccountRecord | null>;

  abstract createPendingAccount(
    input: CreatePendingAccountInput,
  ): Promise<AccountRecord>;

  abstract activateAccount(userId: string): Promise<AccountRecord>;

  abstract updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void>;

  abstract createExclusiveSession(
    userId: string,
    sessionData: CreateExclusiveSessionInput,
  ): Promise<CreateExclusiveSessionResult>;

  abstract rotateRefreshToken(
    sessionId: string,
    input: RotateRefreshTokenInput,
  ): Promise<CreateExclusiveSessionResult>;

  abstract revokeSession(
    sessionId: string,
    reason: SessionRevocationReason,
  ): Promise<void>;

  abstract revokeAllSessions(
    userId: string,
    reason: SessionRevocationReason,
  ): Promise<string[]>;

  abstract findSessionByRefreshTokenHash(
    hash: string,
  ): Promise<AuthSessionRecord | null>;

  abstract findActiveSessionById(
    sessionId: string,
  ): Promise<AuthSessionRecord | null>;

  abstract findRefreshTokenHistoryByHash(
    hash: string,
  ): Promise<SessionRefreshTokenRecord | null>;

  abstract createPasswordResetToken(
    userId: string,
    input: CreatePasswordResetTokenInput,
  ): Promise<PasswordResetTokenRecord>;

  abstract consumePasswordResetToken(
    tokenHash: string,
  ): Promise<PasswordResetTokenRecord | null>;

  abstract invalidatePreviousResetTokens(userId: string): Promise<void>;
}
