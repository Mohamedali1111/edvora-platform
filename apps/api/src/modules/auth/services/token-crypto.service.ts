import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class TokenCryptoService {
  generateOpaqueToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }

  hashOpaqueToken(rawToken: string): string {
    return createHash('sha256').update(rawToken, 'utf8').digest('hex');
  }

  isCanonicalTokenHash(value: string): boolean {
    return SHA256_HEX_PATTERN.test(value);
  }

  timingSafeEqualHex(left: string, right: string): boolean {
    if (!this.isCanonicalTokenHash(left) || !this.isCanonicalTokenHash(right)) {
      return false;
    }

    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  }
}
