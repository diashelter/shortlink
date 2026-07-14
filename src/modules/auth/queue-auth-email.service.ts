import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AUTH_EMAIL_QUEUE } from '../../redis.module';
import { AuthIssuancePurpose } from './auth-state.service';
import {
  AuthEmailService,
  EnqueuePasswordResetInput,
  EnqueueVerificationCodeInput,
  SEND_PASSWORD_RESET_JOB,
  SEND_VERIFICATION_CODE_JOB,
  SendPasswordResetJobData,
  SendVerificationCodeJobData,
} from './auth-email.service';

@Injectable()
export class QueueAuthEmailService extends AuthEmailService {
  constructor(
    @InjectQueue(AUTH_EMAIL_QUEUE)
    private readonly authEmailQueue: Queue,
  ) {
    super();
  }

  async enqueueVerificationCode(
    input: EnqueueVerificationCodeInput,
  ): Promise<void> {
    if (input.purpose === AuthIssuancePurpose.ACTIVATION) {
      if (!input.userId) {
        throw new Error('Activation email jobs require userId.');
      }

      const data: SendVerificationCodeJobData = {
        purpose: AuthIssuancePurpose.ACTIVATION,
        userId: input.userId,
        issuanceId: input.issuanceId,
      };

      await this.authEmailQueue.add(SEND_VERIFICATION_CODE_JOB, data);
      return;
    }

    if (!input.challengeId) {
      throw new Error('Login email jobs require challengeId.');
    }

    const data: SendVerificationCodeJobData = {
      purpose: AuthIssuancePurpose.LOGIN,
      challengeId: input.challengeId,
      issuanceId: input.issuanceId,
    };

    await this.authEmailQueue.add(SEND_VERIFICATION_CODE_JOB, data);
  }

  async enqueuePasswordReset(input: EnqueuePasswordResetInput): Promise<void> {
    const data: SendPasswordResetJobData = {
      purpose: AuthIssuancePurpose.RESET,
      userId: input.userId,
      issuanceId: input.issuanceId,
    };

    await this.authEmailQueue.add(SEND_PASSWORD_RESET_JOB, data);
  }
}
