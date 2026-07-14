import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyLoginDto,
} from './auth.dto';

@Injectable()
export class AuthService {
  async register(_input: RegisterDto): Promise<void> {
    throw new NotImplementedException('Auth register is not implemented yet.');
  }

  async verifyEmail(_input: VerifyEmailDto): Promise<void> {
    throw new NotImplementedException(
      'Auth verify-email is not implemented yet.',
    );
  }

  async resendEmailVerification(_input: EmailDto): Promise<void> {
    throw new NotImplementedException(
      'Auth resend-email-verification is not implemented yet.',
    );
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
}
