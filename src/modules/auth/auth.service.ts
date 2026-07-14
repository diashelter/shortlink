import {
  HttpException,
  HttpStatus,
  Injectable,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyLoginDto,
} from './auth.dto';
import { AccountStatus } from './account-status.enum';
import { AuthAuditService } from './auth-audit.service';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthEmailService } from './auth-email.service';
import { AuthRepository } from './auth.repository';
import {
  AuthIssuancePurpose,
  AuthSecurityStorageUnavailableError,
  AuthStateService,
} from './auth-state.service';
import { AuthSessionService } from './auth-session.service';
import { AuthAuditEventType } from './auth.types';
import { Email } from './email.value-object';
import { Password } from './password.value-object';
import { PasswordHash } from './password-hash.value-object';
import { PasswordHasherService } from './password-hasher.service';

const RATE_LIMIT_TTL_SECONDS = 3600;
const LOGIN_RATE_LIMIT_TTL_SECONDS = 15 * 60;
const EMAIL_RATE_LIMIT = 3;
const IP_RATE_LIMIT = 10;
const LOGIN_RATE_LIMIT = 10;
const LOGIN_CHALLENGE_TTL_MS = 60 * 60 * 1000;
const LOGIN_LOCK_RETRY_AFTER_SECONDS = 3600;
const ACTIVATION_RESEND_PURPOSE = 'activation';
const REGISTER_RATE_OPERATION = 'register';
const RESEND_RATE_OPERATION = 'resend-email-verification';
const LOGIN_RATE_OPERATION = 'login';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly authState: AuthStateService,
    private readonly authEmail: AuthEmailService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly authCrypto: AuthCryptoService,
    private readonly authSession: AuthSessionService,
    private readonly authAudit: AuthAuditService,
  ) {}

  async register(input: RegisterDto, clientIp: string): Promise<void> {
    const email = this.parseEmail(input.email);
    const password = this.parsePassword(input.password);
    this.assertPasswordConfirmation(input.password, input.passwordConfirmation);

    await this.assertWithinRateLimits(
      REGISTER_RATE_OPERATION,
      email.value,
      clientIp,
    );

    return this.withSecurityStorage(async () => {
      const existing = await this.authRepository.findAccountByEmail(email.value);

      if (!existing) {
        const passwordHash = await this.passwordHasher.hash(password);
        const account = await this.authRepository.createPendingAccount({
          email: email.value,
          passwordHash: passwordHash.value,
        });
        await this.enqueueActivation(account.id);
        return;
      }

      if (existing.status === AccountStatus.ACTIVE) {
        return;
      }

      await this.enqueueActivationIfAllowed(existing.id);
    });
  }

  async verifyEmail(input: VerifyEmailDto): Promise<void> {
    const email = this.parseEmail(input.email);

    return this.withSecurityStorage(async () => {
      const account = await this.authRepository.findAccountByEmail(email.value);
      if (!account || account.status !== AccountStatus.PENDING) {
        throw this.invalidVerificationException();
      }

      const result = await this.authState.consumeActivationCode(
        account.id,
        input.code,
      );
      if (result.status !== 'consumed') {
        throw this.invalidVerificationException();
      }

      await this.authRepository.activateAccount(account.id);
    });
  }

  async resendEmailVerification(
    input: EmailDto,
    clientIp: string,
  ): Promise<void> {
    const email = this.parseEmail(input.email);

    await this.assertWithinRateLimits(
      RESEND_RATE_OPERATION,
      email.value,
      clientIp,
    );

    return this.withSecurityStorage(async () => {
      const existing = await this.authRepository.findAccountByEmail(email.value);
      if (!existing || existing.status !== AccountStatus.PENDING) {
        return;
      }

      await this.enqueueActivationIfAllowed(existing.id);
    });
  }

  async startLogin(
    input: LoginDto,
    clientIp: string,
  ): Promise<{
    challengeId: string;
    expiresAt: string;
  }> {
    const email = this.parseEmail(input.email);

    await this.assertLoginRateLimit(email.value, clientIp);

    return this.withSecurityStorage(async () => {
      const account = await this.authRepository.findAccountByEmail(email.value);
      const passwordMatches = await this.passwordMatchesAccount(
        input.password,
        account?.passwordHash,
      );

      if (!account || !passwordMatches) {
        if (account) {
          await this.recordFailedLogin(account.id);
        }
        throw this.invalidCredentialsException();
      }

      if (account.status === AccountStatus.PENDING) {
        throw this.emailNotVerifiedException();
      }

      if (await this.authState.isLoginLocked(account.id)) {
        throw this.accountTemporarilyLockedException();
      }

      const challengeId = this.authCrypto.generateChallengeId();
      const issuanceId = this.authCrypto.generateChallengeId();
      const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MS);
      const placeholderCode = this.authCrypto.generateVerificationCode();

      await this.authState.createLoginChallenge(
        account.id,
        challengeId,
        placeholderCode,
        expiresAt,
      );
      await this.authState.setIssuance(
        AuthIssuancePurpose.LOGIN,
        challengeId,
        issuanceId,
      );
      await this.authEmail.enqueueVerificationCode({
        purpose: AuthIssuancePurpose.LOGIN,
        challengeId,
        issuanceId,
      });

      return {
        challengeId,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async completeLogin(input: VerifyLoginDto): Promise<{
    accessToken: string;
    expiresIn: number;
    csrfToken: string;
    refreshToken: string;
  }> {
    return this.withSecurityStorage(async () => {
      const challengeUserId = await this.authState.findLoginChallengeUserId(
        input.challengeId,
      );

      if (
        challengeUserId &&
        (await this.authState.isLoginLocked(challengeUserId))
      ) {
        throw this.accountTemporarilyLockedException();
      }

      const consumed = await this.authState.consumeLoginChallenge(
        input.challengeId,
        input.code,
      );

      if (consumed.status !== 'consumed') {
        if (challengeUserId) {
          const failure = await this.recordFailedLogin(challengeUserId);
          if (failure.locked) {
            throw this.accountTemporarilyLockedException();
          }
        }
        throw this.invalidCredentialsException();
      }

      if (await this.authState.isLoginLocked(consumed.userId)) {
        throw this.accountTemporarilyLockedException();
      }

      const account = await this.authRepository.findAccountById(consumed.userId);
      if (!account || account.status !== AccountStatus.ACTIVE) {
        throw this.invalidCredentialsException();
      }

      const tokens = await this.authSession.createSessionAfterLogin(
        account.id,
        account.role,
      );

      await this.authAudit.record({
        type: AuthAuditEventType.SESSION_CREATED,
        userId: account.id,
        sessionId: tokens.sessionId,
      });

      return {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        csrfToken: tokens.csrfToken,
        refreshToken: tokens.refreshToken,
      };
    });
  }

  async refresh(_refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
  }> {
    throw new NotImplementedException('Auth refresh is not implemented yet.');
  }

  async logout(_refreshToken: string): Promise<void> {
    throw new NotImplementedException('Auth logout is not implemented yet.');
  }

  async requestPasswordReset(_input: EmailDto): Promise<void> {
    throw new NotImplementedException(
      'Auth forgot-password is not implemented yet.',
    );
  }

  async resetPassword(_input: ResetPasswordDto): Promise<void> {
    throw new NotImplementedException(
      'Auth reset-password is not implemented yet.',
    );
  }

  private async enqueueActivationIfAllowed(userId: string): Promise<void> {
    const coolingDown = await this.authState.isResendCooldownActive(
      ACTIVATION_RESEND_PURPOSE,
      userId,
    );
    if (coolingDown) {
      return;
    }

    await this.enqueueActivation(userId);
  }

  private async enqueueActivation(userId: string): Promise<void> {
    const issuanceId = this.authCrypto.generateChallengeId();
    await this.authState.setIssuance(
      AuthIssuancePurpose.ACTIVATION,
      userId,
      issuanceId,
    );
    await this.authState.setResendCooldown(ACTIVATION_RESEND_PURPOSE, userId);
    await this.authEmail.enqueueVerificationCode({
      purpose: AuthIssuancePurpose.ACTIVATION,
      userId,
      issuanceId,
    });
  }

  private async passwordMatchesAccount(
    rawPassword: string,
    passwordHash: string | undefined,
  ): Promise<boolean> {
    if (!passwordHash) {
      return false;
    }

    try {
      const password = Password.create(rawPassword);
      return this.passwordHasher.compare(
        password,
        PasswordHash.create(passwordHash),
      );
    } catch {
      return false;
    }
  }

  private async recordFailedLogin(
    userId: string,
  ): Promise<{ failures: number; locked: boolean }> {
    const failure = await this.authState.incrementFailedLogin(userId);
    await this.authAudit.record({
      type: failure.locked
        ? AuthAuditEventType.LOGIN_LOCKED
        : AuthAuditEventType.LOGIN_FAILURE,
      userId,
      metadata: { failures: failure.failures },
    });
    return failure;
  }

  private async assertLoginRateLimit(
    email: string,
    clientIp: string,
  ): Promise<void> {
    await this.withSecurityStorage(async () => {
      const count = await this.authState.incrementRateLimit(
        LOGIN_RATE_OPERATION,
        'email',
        this.hashRateLimitValue(`${clientIp || 'unknown'}|${email}`),
        LOGIN_RATE_LIMIT_TTL_SECONDS,
      );
      if (count > LOGIN_RATE_LIMIT) {
        throw this.rateLimitedException();
      }
    });
  }

  private async assertWithinRateLimits(
    operation: string,
    email: string,
    clientIp: string,
  ): Promise<void> {
    await this.withSecurityStorage(async () => {
      const emailCount = await this.authState.incrementRateLimit(
        operation,
        'email',
        this.hashRateLimitValue(email),
        RATE_LIMIT_TTL_SECONDS,
      );
      if (emailCount > EMAIL_RATE_LIMIT) {
        throw this.rateLimitedException();
      }

      const ipCount = await this.authState.incrementRateLimit(
        operation,
        'ip',
        this.hashRateLimitValue(clientIp || 'unknown'),
        RATE_LIMIT_TTL_SECONDS,
      );
      if (ipCount > IP_RATE_LIMIT) {
        throw this.rateLimitedException();
      }
    });
  }

  private async withSecurityStorage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof AuthSecurityStorageUnavailableError) {
        throw new HttpException(
          {
            code: 'AUTH_SECURITY_STORAGE_UNAVAILABLE',
            message: 'Authentication security storage is unavailable.',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }

  private parseEmail(raw: string): Email {
    try {
      return Email.create(raw);
    } catch {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: { email: ['email must be a valid email address'] },
      });
    }
  }

  private parsePassword(raw: string): Password {
    try {
      return Password.create(raw);
    } catch {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: {
          password: [
            'password must be at least 8 characters and include upper, lower, digit, and special characters',
          ],
        },
      });
    }
  }

  private assertPasswordConfirmation(
    password: string,
    passwordConfirmation: string,
  ): void {
    if (password !== passwordConfirmation) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: {
          passwordConfirmation: ['passwordConfirmation must match password'],
        },
      });
    }
  }

  private hashRateLimitValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private rateLimitedException(): HttpException {
    return new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private invalidCredentialsException(): HttpException {
    return new HttpException(
      {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  private emailNotVerifiedException(): HttpException {
    return new HttpException(
      {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email address has not been verified.',
      },
      HttpStatus.FORBIDDEN,
    );
  }

  private accountTemporarilyLockedException(): HttpException {
    return new HttpException(
      {
        code: 'ACCOUNT_TEMPORARILY_LOCKED',
        message: 'Account is temporarily locked.',
        retryAfter: LOGIN_LOCK_RETRY_AFTER_SECONDS,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private invalidVerificationException(): HttpException {
    return new HttpException(
      {
        code: 'INVALID_VERIFICATION',
        message: 'Invalid or expired verification.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
