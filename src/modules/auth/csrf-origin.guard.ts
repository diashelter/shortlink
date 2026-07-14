import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';

type CsrfOriginRequest = {
  headers: {
    origin?: string;
    referer?: string;
    'x-csrf-token'?: string | string[];
  };
};

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const allowedOrigins = validateEnvironment().corsAllowedOrigins;
    const request = context.switchToHttp().getRequest<CsrfOriginRequest>();
    const csrfHeader = request.headers['x-csrf-token'];
    const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

    if (!csrfToken?.trim()) {
      throw new ForbiddenException({
        code: 'CSRF_VALIDATION_FAILED',
        message: 'CSRF validation failed.',
      });
    }

    const origin = this.resolveOrigin(
      request.headers.origin,
      request.headers.referer,
    );

    if (!origin || !allowedOrigins.includes(origin)) {
      throw new ForbiddenException({
        code: 'CSRF_VALIDATION_FAILED',
        message: 'CSRF validation failed.',
      });
    }

    return true;
  }

  private resolveOrigin(
    origin: string | undefined,
    referer: string | undefined,
  ): string | null {
    if (origin?.trim()) {
      return origin.trim();
    }

    if (!referer?.trim()) {
      return null;
    }

    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
}
