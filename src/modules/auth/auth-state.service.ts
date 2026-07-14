export const AUTH_SECURITY_STORAGE_UNAVAILABLE =
  'AUTH_SECURITY_STORAGE_UNAVAILABLE';

export class AuthSecurityStorageUnavailableError extends Error {
  readonly code = AUTH_SECURITY_STORAGE_UNAVAILABLE;

  constructor(message = 'Authentication security storage is unavailable') {
    super(message);
    this.name = 'AuthSecurityStorageUnavailableError';
  }
}

export enum AuthIssuancePurpose {
  ACTIVATION = 'activation',
  LOGIN = 'login',
  RESET = 'reset',
}

export type ConsumeActivationResult =
  | { status: 'consumed' }
  | { status: 'invalid'; attempts: number }
  | { status: 'missing' };

export type ConsumeLoginChallengeResult =
  | { status: 'consumed'; userId: string }
  | { status: 'invalid' }
  | { status: 'missing' };

export type FailedLoginResult = {
  failures: number;
  locked: boolean;
};

export type SessionCacheRecord = {
  sessionId: string;
  userId: string;
  role: string;
  expiresAt: Date;
  active: boolean;
};

export type RateLimitDimension = 'email' | 'ip';

export abstract class AuthStateService {
  abstract setActivationCode(
    userId: string,
    code: string,
    resendAvailableAt: Date,
  ): Promise<void>;

  abstract consumeActivationCode(
    userId: string,
    code: string,
  ): Promise<ConsumeActivationResult>;

  abstract setIssuance(
    purpose: AuthIssuancePurpose,
    subjectId: string,
    issuanceId: string,
  ): Promise<void>;

  abstract isCurrentIssuance(
    purpose: AuthIssuancePurpose,
    subjectId: string,
    issuanceId: string,
  ): Promise<boolean>;

  abstract createLoginChallenge(
    userId: string,
    challengeId: string,
    code: string,
    expiresAt: Date,
  ): Promise<void>;

  abstract findLoginChallengeUserId(
    challengeId: string,
  ): Promise<string | null>;

  abstract consumeLoginChallenge(
    challengeId: string,
    code: string,
  ): Promise<ConsumeLoginChallengeResult>;

  abstract setResendCooldown(purpose: string, userId: string): Promise<void>;

  abstract isResendCooldownActive(
    purpose: string,
    userId: string,
  ): Promise<boolean>;

  abstract incrementRateLimit(
    operation: string,
    dimension: RateLimitDimension,
    hash: string,
    ttlSeconds: number,
  ): Promise<number>;

  abstract getRateLimitCount(
    operation: string,
    dimension: RateLimitDimension,
    hash: string,
  ): Promise<number>;

  abstract incrementFailedLogin(userId: string): Promise<FailedLoginResult>;

  abstract isLoginLocked(userId: string): Promise<boolean>;

  abstract setSessionCache(session: SessionCacheRecord): Promise<void>;

  abstract getSessionCache(
    sessionId: string,
  ): Promise<SessionCacheRecord | null>;

  abstract deleteSessionCache(sessionId: string): Promise<void>;
}
