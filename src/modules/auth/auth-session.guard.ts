import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthPrincipal, AuthSessionService } from './auth-session.service';

export type AuthenticatedRequest = {
  headers: {
    authorization?: string;
  };
  user?: AuthPrincipal;
};

@Injectable()
export class AuthSessionGuard implements CanActivate {
  constructor(
    private readonly crypto: AuthCryptoService,
    private readonly sessions: AuthSessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload;
    try {
      payload = this.crypto.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException();
    }

    const principal = await this.sessions.validateSession(payload.sessionId);
    if (
      !principal ||
      principal.userId !== payload.sub ||
      principal.role !== payload.role
    ) {
      throw new UnauthorizedException();
    }

    request.user = principal;
    return true;
  }
}
