import { Inject, Injectable } from '@nestjs/common';
import { argon2id, hash, needsRehash, verify } from 'argon2';
import type { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import { PasswordPolicyError } from '../errors/auth.errors';

@Injectable()
export class PasswordService {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async hashPassword(plaintextPassword: string): Promise<string> {
    this.assertPasswordPolicy(plaintextPassword);

    return hash(plaintextPassword, {
      type: argon2id,
      memoryCost: this.config.argon2id.memoryCostKiB,
      timeCost: this.config.argon2id.timeCost,
      parallelism: this.config.argon2id.parallelism,
    });
  }

  async verifyPassword(plaintextPassword: string, storedHash: string): Promise<boolean> {
    if (!plaintextPassword || !storedHash) {
      return false;
    }

    try {
      return await verify(storedHash, plaintextPassword);
    } catch {
      return false;
    }
  }

  needsRehash(storedHash: string): boolean {
    try {
      return needsRehash(storedHash, {
        memoryCost: this.config.argon2id.memoryCostKiB,
        timeCost: this.config.argon2id.timeCost,
        parallelism: this.config.argon2id.parallelism,
      });
    } catch {
      return true;
    }
  }

  assertPasswordPolicy(plaintextPassword: string): void {
    const { minLength, maxLength } = this.config.passwordPolicy;
    const length = Array.from(plaintextPassword).length;

    if (length < minLength) {
      throw new PasswordPolicyError(`Password must be at least ${minLength} characters.`);
    }

    if (length > maxLength) {
      throw new PasswordPolicyError(`Password must be at most ${maxLength} characters.`);
    }
  }
}
