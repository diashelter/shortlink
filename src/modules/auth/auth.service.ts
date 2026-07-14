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
import { AuthCryptoService } from './auth-crypto.service';
import { AuthEmailService } from './auth-email.service';
import { AuthRepository } from './auth.repository';
import {
  AuthIssuancePurpose,
  AuthSecurityStorageUnavailableError,
  AuthStateService,
} from './auth-state.service';
import { Email } from './email.value-object';
import { Password } from './password.value-object';
import { PasswordHasherService } from './password-hasher.service';

const RATE_LIMIT_TTL_SECONDS = 3600;
const EMAIL_RATE_LIMIT = 3;
const IP_RATE_LIMIT = 10;
const ACTIVATION_RESEND_PURPOSE = 'activation';
const REGISTER_RATE_OPERATION = 'register';
const RESEND_RATE_OPERATION = 'resend-email-verification';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly authState: AuthStateService,
    private readonly authEmail: AuthEmailService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly authCrypto: AuthCryptoService,
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

  async verifyEmail(_input: VerifyEmailDto): Promise<void> {
    throw new NotImplementedException(
      'Auth verify-email is not implemented yet.',
    );
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

  async startLogin(_input: LoginDto): Promise<{
    challengeId: string;
    expiresAt: string;
  }> {
    throw new NotImplementedException('Auth login is not implemented yet.');
  }

  async completeLogin(_input: VerifyLoginDto): Promise<{
    accessToken: string;
    expiresIn: number;
    csrfToken: string;
    refreshToken: string;
  }> {
    throw new NotImplementedException(
      'Auth verify-login is not implemented yet.',
    );
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
}
