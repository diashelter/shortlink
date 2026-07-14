import { Module, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnvironment } from '../../environment.validation';
import { RedisModule } from '../../redis.module';
import { RedisService } from '../../redis.service';
import { AccountEntity } from './account.entity';
import { AuthAuditEventEntity } from './auth-audit-event.entity';
import { AuthAuditService } from './auth-audit.service';
import { AuthController } from './auth.controller';
import { AuthCryptoService } from './auth-crypto.service';
import { AuthEmailService } from './auth-email.service';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { AuthSessionEntity } from './auth-session.entity';
import { AuthSessionGuard } from './auth-session.guard';
import { AuthSessionService } from './auth-session.service';
import { AuthStateService } from './auth-state.service';
import { AuthTestController } from './auth-test.controller';
import { BcryptPasswordHasherService } from './bcrypt-password-hasher.service';
import { CsrfOriginGuard } from './csrf-origin.guard';
import { NodeAuthCryptoService } from './node-auth-crypto.service';
import { PasswordHasherService } from './password-hasher.service';
import { PasswordResetTokenEntity } from './password-reset-token.entity';
import { QueueAuthEmailService } from './queue-auth-email.service';
import { RedisAuthStateService } from './redis-auth-state.service';
import { SessionRefreshTokenEntity } from './session-refresh-token.entity';
import { TypeormAuthAuditService } from './typeorm-auth-audit.service';
import { TypeormAuthRepository } from './typeorm-auth.repository';

const testControllers: Type<unknown>[] =
  process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined
    ? [AuthTestController]
    : [];

@Module({
  imports: [
    RedisModule,
    TypeOrmModule.forFeature([
      AccountEntity,
      AuthSessionEntity,
      SessionRefreshTokenEntity,
      PasswordResetTokenEntity,
      AuthAuditEventEntity,
    ]),
  ],
  controllers: [AuthController, ...testControllers],
  providers: [
    AuthService,
    AuthSessionService,
    AuthSessionGuard,
    CsrfOriginGuard,
    QueueAuthEmailService,
    {
      provide: AuthEmailService,
      useExisting: QueueAuthEmailService,
    },
    {
      provide: AuthRepository,
      useClass: TypeormAuthRepository,
    },
    {
      provide: AuthStateService,
      useFactory: (redis: RedisService) => new RedisAuthStateService(redis),
      inject: [RedisService],
    },
    {
      provide: AuthAuditService,
      useClass: TypeormAuthAuditService,
    },
    {
      provide: PasswordHasherService,
      useClass: BcryptPasswordHasherService,
    },
    {
      provide: AuthCryptoService,
      useFactory: () => {
        const env = validateEnvironment();
        return new NodeAuthCryptoService(
          env.authHmacSecret,
          env.authTokenHashSecret,
          env.jwtAccessSecret,
        );
      },
    },
  ],
  exports: [
    AuthSessionGuard,
    AuthSessionService,
    AuthCryptoService,
    AuthStateService,
    AuthRepository,
    AuthEmailService,
    TypeOrmModule,
  ],
})
export class AuthModule {}
