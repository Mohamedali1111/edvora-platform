import { PasswordPolicyError } from '../errors/auth.errors';
import { testAuthConfig } from '../test-helpers';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  it('hashes valid passwords with Argon2id and verifies them', async () => {
    const service = new PasswordService(testAuthConfig);
    const passwordHash = await service.hashPassword('correct horse battery staple');

    expect(passwordHash).toContain('$argon2id$');
    await expect(service.verifyPassword('correct horse battery staple', passwordHash)).resolves.toBe(true);
    await expect(service.verifyPassword('wrong horse battery staple', passwordHash)).resolves.toBe(false);
  });

  it('enforces password length without silent truncation', async () => {
    const service = new PasswordService(testAuthConfig);

    await expect(service.hashPassword('short')).rejects.toBeInstanceOf(PasswordPolicyError);
    await expect(service.hashPassword('x'.repeat(129))).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it('detects hashes that need stronger configured parameters', async () => {
    const weaker = new PasswordService({
      ...testAuthConfig,
      argon2id: {
        memoryCostKiB: 8 * 1024,
        timeCost: 2,
        parallelism: 1,
      },
    });
    const current = new PasswordService(testAuthConfig);
    const weakerHash = await weaker.hashPassword('correct horse battery staple');

    expect(current.needsRehash(weakerHash)).toBe(true);
  });
});
