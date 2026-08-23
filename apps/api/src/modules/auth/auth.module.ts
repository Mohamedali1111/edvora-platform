import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { createAuthRuntimeConfig } from './auth.config';
import { AUTH_RUNTIME_CONFIG } from './auth.constants';
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
  imports: [DatabaseModule],
  providers: [
    {
      provide: AUTH_RUNTIME_CONFIG,
      useFactory: createAuthRuntimeConfig,
    },
    AccountActivationTokenService,
    AuthOrchestrationService,
    JwtService,
    AccessTokenService,
    ClockService,
    PasswordService,
    PasswordResetTokenService,
    RefreshSessionService,
    SecurityEventService,
    TokenCryptoService,
    UuidV7Service,
  ],
  exports: [
    AccountActivationTokenService,
    AccessTokenService,
    AuthOrchestrationService,
    ClockService,
    PasswordService,
    PasswordResetTokenService,
    RefreshSessionService,
    SecurityEventService,
    TokenCryptoService,
    UuidV7Service,
  ],
})
export class AuthModule {}
