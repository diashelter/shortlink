import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyLoginDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { CsrfOriginGuard } from './csrf-origin.guard';

const GENERIC_ACCEPTED = { message: 'Accepted.' };

@Controller('auth')
export class AuthController {
  private readonly refreshCookieName: string;

  constructor(private readonly authService: AuthService) {
    this.refreshCookieName =
      process.env.REFRESH_COOKIE_NAME?.trim() || 'shortlink_refresh';
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: RegisterDto): Promise<{ message: string }> {
    await this.authService.register(body);
    return GENERIC_ACCEPTED;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.authService.verifyEmail(body);
  }

  @Post('resend-email-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendEmailVerification(
    @Body() body: EmailDto,
  ): Promise<{ message: string }> {
    await this.authService.resendEmailVerification(body);
    return GENERIC_ACCEPTED;
  }

  @Post('login')
  @HttpCode(HttpStatus.ACCEPTED)
  async login(
    @Body() body: LoginDto,
  ): Promise<{ challengeId: string; expiresAt: string }> {
    return this.authService.startLogin(body);
  }

  @Post('verify-login')
  @HttpCode(HttpStatus.OK)
  async verifyLogin(
    @Body() body: VerifyLoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{
    accessToken: string;
    expiresIn: number;
    csrfToken: string;
  }> {
    const tokens = await this.authService.completeLogin(body);
    this.setRefreshCookie(response, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      csrfToken: tokens.csrfToken,
    };
  }

  @Post('refresh')
  @UseGuards(CsrfOriginGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const refreshToken = this.readRefreshCookie(request);
    const tokens = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  @Post('logout')
  @UseGuards(CsrfOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const refreshToken = this.readRefreshCookie(request);
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(response);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: EmailDto): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(body);
    return GENERIC_ACCEPTED;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(body);
  }

  private readRefreshCookie(request: Request): string {
    const value = request.cookies?.[this.refreshCookieName];
    return typeof value === 'string' ? value : '';
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    response.cookie(this.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(this.refreshCookieName, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  }
}
