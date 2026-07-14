import { AuthIssuancePurpose } from './auth-state.service';

export const SEND_VERIFICATION_CODE_JOB = 'send-verification-code';
export const SEND_PASSWORD_RESET_JOB = 'send-password-reset';

export type EnqueueVerificationCodeInput = {
  purpose: AuthIssuancePurpose.ACTIVATION | AuthIssuancePurpose.LOGIN;
  issuanceId: string;
  userId?: string;
  challengeId?: string;
};

export type EnqueuePasswordResetInput = {
  userId: string;
  issuanceId: string;
};

export type SendVerificationCodeJobData = {
  purpose: AuthIssuancePurpose.ACTIVATION | AuthIssuancePurpose.LOGIN;
  issuanceId: string;
  userId?: string;
  challengeId?: string;
};

export type SendPasswordResetJobData = {
  purpose: AuthIssuancePurpose.RESET;
  userId: string;
  issuanceId: string;
};

export type AuthEmailJobData =
  SendVerificationCodeJobData | SendPasswordResetJobData;

export abstract class AuthEmailService {
  abstract enqueueVerificationCode(
    input: EnqueueVerificationCodeInput,
  ): Promise<void>;

  abstract enqueuePasswordReset(
    input: EnqueuePasswordResetInput,
  ): Promise<void>;
}
