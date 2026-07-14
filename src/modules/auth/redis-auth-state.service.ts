import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';
import { RedisService } from '../../redis.service';
import {
  AuthIssuancePurpose,
  AuthSecurityStorageUnavailableError,
  AuthStateService,
  ConsumeActivationResult,
  ConsumeLoginChallengeResult,
  FailedLoginResult,
  RateLimitDimension,
  SessionCacheRecord,
} from './auth-state.service';

const KEY_PREFIX = 'shortlink:auth:';
const TTL_ONE_HOUR_SECONDS = 3600;
const TTL_RESEND_COOLDOWN_SECONDS = 60;
const MAX_FAILED_LOGINS = 5;

const CONSUME_ACTIVATION_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'missing'}
end
local payload = cjson.decode(raw)
if payload.codeHmac == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'consumed'}
end
payload.attempts = (payload.attempts or 0) + 1
redis.call('SET', KEYS[1], cjson.encode(payload), 'KEEPTTL')
return {'invalid', tostring(payload.attempts)}
`;

const CONSUME_LOGIN_CHALLENGE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'missing'}
end
local payload = cjson.decode(raw)
if payload.used then
  return {'missing'}
end
if payload.codeHmac ~= ARGV[1] then
  return {'invalid'}
end
local nowMs = tonumber(ARGV[2])
if payload.expiresAtMs and nowMs > tonumber(payload.expiresAtMs) then
  redis.call('DEL', KEYS[1])
  return {'missing'}
end
redis.call('DEL', KEYS[1])
return {'consumed', payload.userId}
`;

const CREATE_LOGIN_CHALLENGE_LUA = `
local accountKey = KEYS[1]
local challengeKey = KEYS[2]
local previousChallengeId = redis.call('GET', accountKey)
if previousChallengeId then
  redis.call('DEL', ARGV[4] .. previousChallengeId)
end
redis.call('SET', challengeKey, ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('SET', accountKey, ARGV[3], 'EX', tonumber(ARGV[2]))
return 'OK'
`;

const INCREMENT_FAILED_LOGIN_LUA = `
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local locked = 0
if failures >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', tonumber(ARGV[1]))
  locked = 1
end
return {failures, locked}
`;

const INCREMENT_RATE_LIMIT_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

type ActivationPayload = {
  codeHmac: string;
  attempts: number;
  resendAvailableAt: number;
};

type LoginChallengePayload = {
  userId: string;
  codeHmac: string;
  expiresAtMs: number;
  used: boolean;
};

type SessionCachePayload = {
  sessionId: string;
  userId: string;
  role: string;
  expiresAt: string;
  active: boolean;
};

@Injectable()
export class RedisAuthStateService extends AuthStateService {
  private readonly hmacSecret: string;

  constructor(
    private readonly redis: RedisService,
    hmacSecret?: string,
  ) {
    super();
    this.hmacSecret =
      hmacSecret ?? validateEnvironment().authHmacSecret;
  }

  async setActivationCode(
    userId: string,
    code: string,
    resendAvailableAt: Date,
  ): Promise<void> {
    const payload: ActivationPayload = {
      codeHmac: this.hmac(code),
      attempts: 0,
      resendAvailableAt: resendAvailableAt.getTime(),
    };

    await this.safe(() =>
      this.redis.set(
        this.activationKey(userId),
        JSON.stringify(payload),
        TTL_ONE_HOUR_SECONDS,
      ),
    );
  }

  async consumeActivationCode(
    userId: string,
    code: string,
  ): Promise<ConsumeActivationResult> {
    const result = await this.safe(() =>
      this.redis.eval(
        CONSUME_ACTIVATION_LUA,
        1,
        this.activationKey(userId),
        this.hmac(code),
      ),
    );

    const [status, attempts] = result as [string, string?];
    if (status === 'consumed') {
      return { status: 'consumed' };
    }
    if (status === 'invalid') {
      return { status: 'invalid', attempts: Number(attempts) };
    }
    return { status: 'missing' };
  }

  async setIssuance(
    purpose: AuthIssuancePurpose,
    subjectId: string,
    issuanceId: string,
  ): Promise<void> {
    await this.safe(() =>
      this.redis.set(
        this.issuanceKey(purpose, subjectId),
        issuanceId,
        TTL_ONE_HOUR_SECONDS,
      ),
    );
  }

  async isCurrentIssuance(
    purpose: AuthIssuancePurpose,
    subjectId: string,
    issuanceId: string,
  ): Promise<boolean> {
    const current = await this.safe(() =>
      this.redis.get(this.issuanceKey(purpose, subjectId)),
    );

    if (current === null) {
      return false;
    }

    return this.constantTimeEquals(current, issuanceId);
  }

  async createLoginChallenge(
    userId: string,
    challengeId: string,
    code: string,
    expiresAt: Date,
  ): Promise<void> {
    const payload: LoginChallengePayload = {
      userId,
      codeHmac: this.hmac(code),
      expiresAtMs: expiresAt.getTime(),
      used: false,
    };

    await this.safe(() =>
      this.redis.eval(
        CREATE_LOGIN_CHALLENGE_LUA,
        2,
        this.loginChallengeAccountKey(userId),
        this.loginChallengeKey(challengeId),
        JSON.stringify(payload),
        TTL_ONE_HOUR_SECONDS,
        challengeId,
        `${KEY_PREFIX}login-challenge:`,
      ),
    );
  }

  async findLoginChallengeUserId(
    challengeId: string,
  ): Promise<string | null> {
    const raw = await this.safe(() =>
      this.redis.get(this.loginChallengeKey(challengeId)),
    );
    if (raw === null) {
      return null;
    }

    const payload = JSON.parse(raw) as LoginChallengePayload;
    if (!payload.userId || payload.used) {
      return null;
    }

    if (payload.expiresAtMs && Date.now() > payload.expiresAtMs) {
      return null;
    }

    return payload.userId;
  }

  async consumeLoginChallenge(
    challengeId: string,
    code: string,
  ): Promise<ConsumeLoginChallengeResult> {
    const result = await this.safe(() =>
      this.redis.eval(
        CONSUME_LOGIN_CHALLENGE_LUA,
        1,
        this.loginChallengeKey(challengeId),
        this.hmac(code),
        Date.now(),
      ),
    );

    const [status, userId] = result as [string, string?];
    if (status === 'consumed' && userId) {
      return { status: 'consumed', userId };
    }
    if (status === 'invalid') {
      return { status: 'invalid' };
    }
    return { status: 'missing' };
  }

  async setResendCooldown(purpose: string, userId: string): Promise<void> {
    await this.safe(() =>
      this.redis.set(
        this.resendKey(purpose, userId),
        '1',
        TTL_RESEND_COOLDOWN_SECONDS,
      ),
    );
  }

  async isResendCooldownActive(
    purpose: string,
    userId: string,
  ): Promise<boolean> {
    const exists = await this.safe(() =>
      this.redis.exists(this.resendKey(purpose, userId)),
    );
    return exists === 1;
  }

  async incrementRateLimit(
    operation: string,
    dimension: RateLimitDimension,
    hash: string,
    ttlSeconds: number,
  ): Promise<number> {
    const count = await this.safe(() =>
      this.redis.eval(
        INCREMENT_RATE_LIMIT_LUA,
        1,
        this.rateKey(operation, dimension, hash),
        ttlSeconds,
      ),
    );
    return Number(count);
  }

  async getRateLimitCount(
    operation: string,
    dimension: RateLimitDimension,
    hash: string,
  ): Promise<number> {
    const raw = await this.safe(() =>
      this.redis.get(this.rateKey(operation, dimension, hash)),
    );
    return raw === null ? 0 : Number(raw);
  }

  async incrementFailedLogin(userId: string): Promise<FailedLoginResult> {
    const result = await this.safe(() =>
      this.redis.eval(
        INCREMENT_FAILED_LOGIN_LUA,
        2,
        this.failedLoginKey(userId),
        this.loginLockKey(userId),
        TTL_ONE_HOUR_SECONDS,
        MAX_FAILED_LOGINS,
      ),
    );

    const [failures, locked] = result as [number, number];
    return {
      failures: Number(failures),
      locked: Number(locked) === 1,
    };
  }

  async isLoginLocked(userId: string): Promise<boolean> {
    const exists = await this.safe(() =>
      this.redis.exists(this.loginLockKey(userId)),
    );
    return exists === 1;
  }

  async setSessionCache(session: SessionCacheRecord): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000),
    );

    const payload: SessionCachePayload = {
      sessionId: session.sessionId,
      userId: session.userId,
      role: session.role,
      expiresAt: session.expiresAt.toISOString(),
      active: session.active,
    };

    await this.safe(() =>
      this.redis.set(
        this.sessionKey(session.sessionId),
        JSON.stringify(payload),
        ttlSeconds,
      ),
    );
  }

  async getSessionCache(
    sessionId: string,
  ): Promise<SessionCacheRecord | null> {
    const raw = await this.safe(() =>
      this.redis.get(this.sessionKey(sessionId)),
    );
    if (raw === null) {
      return null;
    }

    const payload = JSON.parse(raw) as SessionCachePayload;
    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      role: payload.role,
      expiresAt: new Date(payload.expiresAt),
      active: payload.active,
    };
  }

  async deleteSessionCache(sessionId: string): Promise<void> {
    await this.safe(() => this.redis.del(this.sessionKey(sessionId)));
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.hmacSecret).update(value).digest('hex');
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left);
    const rightBuf = Buffer.from(right);
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  }

  private activationKey(userId: string): string {
    return `${KEY_PREFIX}verification:activation:${userId}`;
  }

  private issuanceKey(
    purpose: AuthIssuancePurpose,
    subjectId: string,
  ): string {
    if (purpose === AuthIssuancePurpose.RESET) {
      return `${KEY_PREFIX}reset-issuance:${subjectId}`;
    }
    if (purpose === AuthIssuancePurpose.LOGIN) {
      return `${KEY_PREFIX}verification-issuance:login:${subjectId}`;
    }
    return `${KEY_PREFIX}verification-issuance:activation:${subjectId}`;
  }

  private loginChallengeKey(challengeId: string): string {
    return `${KEY_PREFIX}login-challenge:${challengeId}`;
  }

  private loginChallengeAccountKey(userId: string): string {
    return `${KEY_PREFIX}login-challenge:account:${userId}`;
  }

  private resendKey(purpose: string, userId: string): string {
    return `${KEY_PREFIX}resend:${purpose}:${userId}`;
  }

  private failedLoginKey(userId: string): string {
    return `${KEY_PREFIX}failed-login:${userId}`;
  }

  private loginLockKey(userId: string): string {
    return `${KEY_PREFIX}login-lock:${userId}`;
  }

  private rateKey(
    operation: string,
    dimension: RateLimitDimension,
    hash: string,
  ): string {
    return `${KEY_PREFIX}rate:${operation}:${dimension}:${hash}`;
  }

  private sessionKey(sessionId: string): string {
    return `${KEY_PREFIX}session:${sessionId}`;
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AuthSecurityStorageUnavailableError) {
        throw error;
      }
      throw new AuthSecurityStorageUnavailableError();
    }
  }
}
