import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthSessionGuard } from './auth-session.guard';

/**
 * Test-only routes used by the E2E suite. Registered only when NODE_ENV=test.
 */
@Controller('auth/test')
export class AuthTestController {
  @Get('protected')
  @UseGuards(AuthSessionGuard)
  @HttpCode(HttpStatus.OK)
  protectedRoute(): { ok: true } {
    return { ok: true };
  }
}
