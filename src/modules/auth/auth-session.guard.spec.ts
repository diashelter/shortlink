import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthSessionGuard } from './auth-session.guard';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionGuard', () => {
  let crypto: jest.Mocked<Pick<AuthCryptoService, 'verifyAccessToken'>>;
  let sessions: jest.Mocked<Pick<AuthSessionService, 'validateSession'>>;
  let guard: AuthSessionGuard;

  function createContext(
    authorization?: string,
  ): ExecutionContext & { request: { headers: Record<string, string>; user?: unknown } } {
    const request: {
      headers: Record<string, string>;
      user?: unknown;
    } = {
      headers: authorization ? { authorization } : {},
    };

    return {
      request,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext & {
      request: { headers: Record<string, string>; user?: unknown };
    };
  }

  beforeEach(() => {
    crypto = {
      verifyAccessToken: jest.fn(),
    };
    sessions = {
      validateSession: jest.fn(),
    };
    guard = new AuthSessionGuard(
      crypto as unknown as AuthCryptoService,
      sessions as unknown as AuthSessionService,
    );
  });

  it('rejects requests without a Bearer token', async () => {
    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(createContext('Token abc')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid JWT access tokens', async () => {
    crypto.verifyAccessToken.mockImplementation(() => {
      throw new Error('invalid token');
    });

    await expect(
      guard.canActivate(createContext('Bearer bad.token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the session is no longer active', async () => {
    crypto.verifyAccessToken.mockReturnValue({
      sub: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      iat: 1,
      exp: 2,
    });
    sessions.validateSession.mockResolvedValue(null);

    await expect(
      guard.canActivate(createContext('Bearer good.token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the principal when JWT and session are valid', async () => {
    const context = createContext('Bearer good.token');
    crypto.verifyAccessToken.mockReturnValue({
      sub: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
      iat: 1,
      exp: 2,
    });
    sessions.validateSession.mockResolvedValue({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.request.user).toEqual({
      userId: 'user-1',
      role: 'USER',
      sessionId: 'session-1',
    });
  });
});
