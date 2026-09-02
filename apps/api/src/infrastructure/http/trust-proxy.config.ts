const DEFAULT_TRUST_PROXY_HOPS_PRODUCTION = 1;
const DEFAULT_TRUST_PROXY_HOPS_NON_PRODUCTION = 0;

/**
 * Resolves how many reverse-proxy hops in front of this process Express should trust when
 * deriving `req.ip`/`req.ips` from `X-Forwarded-For` - this is what `@nestjs/throttler`'s
 * default per-client tracker (`req.ip`) actually keys on, so an unconfigured trust boundary
 * silently collapses every client behind the proxy onto one throttle bucket.
 *
 * The intended staging/production topology is Railway, whose public edge terminates TLS and
 * proxies to this container over its internal network as a single hop - exactly the shape
 * Express's numeric `trust proxy` mode exists for. Trusting `1` hop tells Express to take the
 * client address from the one entry a real, trusted proxy appended to `X-Forwarded-For` and to
 * ignore anything a client tried to prepend beyond that boundary - unlike `trust proxy: true`,
 * which would trust the entire header verbatim regardless of how many hops produced it and let
 * a direct client spoof its own address.
 *
 * This is deliberately environment-configurable rather than a hardcoded assumption: this
 * repository cannot verify Railway's exact proxy topology from source, and a future addition
 * of another layer (a CDN, a load balancer) in front of Railway would change the correct hop
 * count. `TRUST_PROXY_HOPS` lets an operator correct this without a code change. Left unset, it
 * defaults to `1` in production (Railway's single-hop edge) and `0` (trust nothing; use the raw
 * socket peer) everywhere else, matching local/dev reality where no proxy sits in front of the
 * process and a client could otherwise spoof `X-Forwarded-For` directly against a trusting app.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const isProduction = env.NODE_ENV === 'production';
  const raw = env.TRUST_PROXY_HOPS?.trim();

  if (!raw) {
    return isProduction ? DEFAULT_TRUST_PROXY_HOPS_PRODUCTION : DEFAULT_TRUST_PROXY_HOPS_NON_PRODUCTION;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer number of trusted reverse-proxy hops.');
  }

  return parsed;
}
