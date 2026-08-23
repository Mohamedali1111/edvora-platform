import { TokenCryptoService } from './token-crypto.service';

describe('TokenCryptoService', () => {
  const service = new TokenCryptoService();

  it('generates transport-safe opaque tokens with at least 256 bits of entropy', () => {
    const token = service.generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('hashes tokens as deterministic lowercase SHA-256 hex', () => {
    const first = service.hashOpaqueToken('example-token');
    const second = service.hashOpaqueToken('example-token');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(service.isCanonicalTokenHash(first)).toBe(true);
  });

  it('compares canonical hex hashes safely', () => {
    const hash = service.hashOpaqueToken('example-token');

    expect(service.timingSafeEqualHex(hash, hash)).toBe(true);
    expect(service.timingSafeEqualHex(hash, service.hashOpaqueToken('other-token'))).toBe(false);
    expect(service.timingSafeEqualHex(hash, 'not-a-hash')).toBe(false);
  });
});
