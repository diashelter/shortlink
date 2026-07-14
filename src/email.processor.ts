import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { validateEnvironment } from './environment.validation';
import { AUTH_EMAIL_QUEUE } from './redis.module';
import { SmtpMailService } from './smtp-mail.service';
import { AuthCryptoService } from './modules/auth/auth-crypto.service';
import {
  AuthEmailJobData,
  SEND_PASSWORD_RESET_JOB,
  SEND_VERIFICATION_CODE_JOB,
  SendPasswordResetJobData,
  SendVerificationCodeJobData,
} from './modules/auth/auth-email.service';
import { AuthRepository } from './modules/auth/auth.repository';
import {
  AuthIssuancePurpose,
  AuthStateService,
} from './modules/auth/auth-state.service';

const ONE_HOUR_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60_000;

@Injectable()
@Processor(AUTH_EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);
  private readonly frontendResetUrl: string;

  constructor(
    private readonly authState: AuthStateService,
    private readonly authRepository: AuthRepository,
    private readonly authCrypto: AuthCryptoService,
    private readonly mail: SmtpMailService,
  ) {
    super();
    this.frontendResetUrl = validateEnvironment().frontendResetUrl;
  }

  async process(job: Job<AuthEmailJobData>): Promise<void> {
    if (job.name === SEND_VERIFICATION_CODE_JOB) {
      await this.processVerificationCode(
        job.data as SendVerificationCodeJobData,
      );
      return;
    }

    if (job.name === SEND_PASSWORD_RESET_JOB) {
      await this.processPasswordReset(job.data as SendPasswordResetJobData);
      return;
    }

    this.logger.warn(`Ignoring unknown auth email job: ${job.name}`);
  }

  private async processVerificationCode(
    data: SendVerificationCodeJobData,
  ): Promise<void> {
    if (data.purpose === AuthIssuancePurpose.ACTIVATION) {
      await this.processActivation(data);
      return;
    }

    await this.processLogin(data);
  }

  private async processActivation(
    data: SendVerificationCodeJobData,
  ): Promise<void> {
    if (!data.userId) {
      return;
    }

    const current = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.ACTIVATION,
      data.userId,
      data.issuanceId,
    );
    if (!current) {
      this.logger.debug(
        `Discarding stale activation issuance ${data.issuanceId}`,
      );
      return;
    }

    const account = await this.authRepository.findAccountById(data.userId);
    if (!account) {
      return;
    }

    const code = this.authCrypto.generateVerificationCode();
    await this.authState.setActivationCode(
      data.userId,
      code,
      new Date(Date.now() + RESEND_COOLDOWN_MS),
    );

    const stillCurrent = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.ACTIVATION,
      data.userId,
      data.issuanceId,
    );
    if (!stillCurrent) {
      return;
    }

    await this.mail.sendMail({
      to: account.email,
      subject: 'Activate your Shortlink account',
      text: `Your activation code is ${code}. It expires in one hour.`,
      html: `<p>Your activation code is <strong>${code}</strong>. It expires in one hour.</p>`,
    });
  }

  private async processLogin(data: SendVerificationCodeJobData): Promise<void> {
    if (!data.challengeId) {
      return;
    }

    const current = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.LOGIN,
      data.challengeId,
      data.issuanceId,
    );
    if (!current) {
      this.logger.debug(`Discarding stale login issuance ${data.issuanceId}`);
      return;
    }

    const userId = await this.authState.findLoginChallengeUserId(
      data.challengeId,
    );
    if (!userId) {
      return;
    }

    const account = await this.authRepository.findAccountById(userId);
    if (!account) {
      return;
    }

    const code = this.authCrypto.generateVerificationCode();
    const expiresAt = new Date(Date.now() + ONE_HOUR_MS);

    await this.authState.createLoginChallenge(
      userId,
      data.challengeId,
      code,
      expiresAt,
    );

    const stillCurrent = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.LOGIN,
      data.challengeId,
      data.issuanceId,
    );
    if (!stillCurrent) {
      return;
    }

    await this.mail.sendMail({
      to: account.email,
      subject: 'Your Shortlink login code',
      text: `Your login code is ${code}. It expires in one hour.`,
      html: `<p>Your login code is <strong>${code}</strong>. It expires in one hour.</p>`,
    });
  }

  private async processPasswordReset(
    data: SendPasswordResetJobData,
  ): Promise<void> {
    const current = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.RESET,
      data.userId,
      data.issuanceId,
    );
    if (!current) {
      this.logger.debug(`Discarding stale reset issuance ${data.issuanceId}`);
      return;
    }

    const account = await this.authRepository.findAccountById(data.userId);
    if (!account) {
      return;
    }

    const token = this.authCrypto.generateOpaqueToken();
    const tokenHash = this.authCrypto.hashToken(token);

    await this.authRepository.createPasswordResetToken(data.userId, {
      tokenHash,
      expiresAt: new Date(Date.now() + ONE_HOUR_MS),
    });

    const stillCurrent = await this.authState.isCurrentIssuance(
      AuthIssuancePurpose.RESET,
      data.userId,
      data.issuanceId,
    );
    if (!stillCurrent) {
      return;
    }

    const resetUrl = `${this.frontendResetUrl}#token=${token}`;

    await this.mail.sendMail({
      to: account.email,
      subject: 'Reset your Shortlink password',
      text: `Reset your password using this link: ${resetUrl}. The link expires in one hour.`,
      html: `<p>Reset your password using this link:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>The link expires in one hour.</p>`,
    });
  }
}
