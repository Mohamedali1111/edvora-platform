import { resolveTrustProxyHops } from './trust-proxy.config';

describe('resolveTrustProxyHops', () => {
  it('trusts no hops by default outside production (no proxy in front locally)', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
    expect(resolveTrustProxyHops({})).toBe(0);
  });

  it('trusts exactly one hop by default in production (Railway single-edge topology)', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
  });

  it('honors an explicit override in either environment', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  it('rejects non-integer or negative values', () => {
    const expected = 'TRUST_PROXY_HOPS must be a non-negative integer number of trusted reverse-proxy hops.';

    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: '-1' })).toThrow(expected);
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: 'abc' })).toThrow(expected);
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: '1.5' })).toThrow(expected);
  });
});
