import { Test } from '@nestjs/testing';
import type { DatabaseRuntimeConfig } from '../../infrastructure/database/database.config';
import { DATABASE_RUNTIME_CONFIG } from '../../infrastructure/database/database.constants';
import { AuthModule } from './auth.module';
import { AUTH_RUNTIME_CONFIG } from './auth.constants';
import { testAuthConfig } from './test-helpers';
import { AccessTokenService } from './services/access-token.service';
import { AccountActivationTokenService } from './services/account-activation-token.service';
import { PasswordResetTokenService } from './services/password-reset-token.service';
import { RefreshSessionService } from './services/refresh-session.service';

const testDatabaseConfig: DatabaseRuntimeConfig = {
  databaseUrl: 'postgresql://edvora_test:temporary@localhost:55432/edvora_auth_test',
  pool: {
    maxConnections: 1,
    connectionTimeoutMillis: 100,
    idleTimeoutMillis: 100,
  },
};

describe('AuthModule', () => {
  it('provides internal auth primitives through Nest dependency injection', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(AUTH_RUNTIME_CONFIG)
      .useValue(testAuthConfig)
      .overrideProvider(DATABASE_RUNTIME_CONFIG)
      .useValue(testDatabaseConfig)
      .compile();

    expect(moduleRef.get(AccessTokenService)).toBeInstanceOf(AccessTokenService);
    expect(moduleRef.get(RefreshSessionService)).toBeInstanceOf(RefreshSessionService);
    expect(moduleRef.get(AccountActivationTokenService)).toBeInstanceOf(AccountActivationTokenService);
    expect(moduleRef.get(PasswordResetTokenService)).toBeInstanceOf(PasswordResetTokenService);

    await moduleRef.close();
  });
});
