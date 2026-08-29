import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthController } from './auth.controller';
import { createAuthRuntimeConfig } from './auth.config';
import { AUTH_RUNTIME_CONFIG } from './auth.constants';
import { createAuthHttpConfig } from './http/auth-http.config';
import { AUTH_HTTP_CONFIG } from './http/auth-http.constants';
import { AuthCookieService } from './http/auth-cookie.service';
import { AccessTokenGuard } from './http/access-token.guard';
import { TrustedOriginGuard } from './http/trusted-origin.guard';
import { AccountActivationTokenService } from './services/account-activation-token.service';
import { AccessTokenService } from './services/access-token.service';
import { AuthOrchestrationService } from './services/auth-orchestration.service';
import { ClockService } from './services/clock.service';
import { PasswordService } from './services/password.service';
import { PasswordResetTokenService } from './services/password-reset-token.service';
import { RefreshSessionService } from './services/refresh-session.service';
import { SecurityEventService } from './services/security-event.service';
import { TokenCryptoService } from './services/token-crypto.service';
import { UuidV7Service } from './services/uuid-v7.service';

@Module({
  imports: [
    DatabaseModule,
    ThrottlerModule.forRoot([
      {
        name: 'auth',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_RUNTIME_CONFIG,
      useFactory: createAuthRuntimeConfig,
    },
    {
      provide: AUTH_HTTP_CONFIG,
      useFactory: createAuthHttpConfig,
    },
    AccountActivationTokenService,
    AccessTokenGuard,
    AuthOrchestrationService,
    AuthCookieService,
    JwtService,
    AccessTokenService,
    ClockService,
    PasswordService,
    PasswordResetTokenService,
    RefreshSessionService,
    SecurityEventService,
    TrustedOriginGuard,
    TokenCryptoService,
    UuidV7Service,
  ],
  exports: [
    AccountActivationTokenService,
    AccessTokenGuard,
    AccessTokenService,
    AuthOrchestrationService,
    ClockService,
    PasswordService,
    PasswordResetTokenService,
    RefreshSessionService,
    SecurityEventService,
    TokenCryptoService,
    AuthCookieService,
    UuidV7Service,
  ],
})
export class AuthModule {}
