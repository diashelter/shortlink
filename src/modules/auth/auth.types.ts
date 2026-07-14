import { AccountRole } from './account-role.enum';
import { AccountStatus } from './account-status.enum';

export enum SessionRevocationReason {
  LOGOUT = 'LOGOUT',
  NEW_LOGIN = 'NEW_LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
  REFRESH_REUSE = 'REFRESH_REUSE',
}

export enum AuthAuditEventType {
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  LOGIN_LOCKED = 'LOGIN_LOCKED',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
}

/** Sanitized audit payload — never include passwords, codes, tokens, raw emails, or headers. */
export type AuthAuditMetadata = Record<string, string | number | boolean | null>;

export type AuthAuditEventRecord = {
  id: string;
  userId: string | null;
  type: AuthAuditEventType;
  sessionId: string | null;
  ipHash: string | null;
  createdAt: Date;
  metadata: AuthAuditMetadata | null;
};

export type RecordAuthAuditEventInput = {
  userId?: string | null;
  type: AuthAuditEventType;
  sessionId?: string | null;
  ipHash?: string | null;
  metadata?: AuthAuditMetadata | null;
};

export type AccountRecord = {
  id: string;
  email: string;
  status: AccountStatus;
  role: AccountRole;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthSessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  csrfTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: SessionRevocationReason | null;
  createdAt: Date;
  lastRotatedAt: Date;
};

export type SessionRefreshTokenRecord = {
  id: string;
  sessionId: string;
  tokenHash: string;
  issuedAt: Date;
  usedAt: Date | null;
  expiresAt: Date;
};

export type PasswordResetTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type CreatePendingAccountInput = {
  email: string;
  passwordHash: string;
};

export type CreateExclusiveSessionInput = {
  refreshTokenHash: string;
  csrfTokenHash: string;
  expiresAt: Date;
};

export type CreateExclusiveSessionResult = {
  session: AuthSessionRecord;
  refreshToken: SessionRefreshTokenRecord;
};

export type RotateRefreshTokenInput = {
  currentTokenHash: string;
  newTokenHash: string;
  newExpiresAt: Date;
};

export type CreatePasswordResetTokenInput = {
  tokenHash: string;
  expiresAt: Date;
};
