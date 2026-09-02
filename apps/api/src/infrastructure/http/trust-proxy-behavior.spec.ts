import * as express from 'express';
import * as request from 'supertest';
import { resolveTrustProxyHops } from './trust-proxy.config';

/**
 * Proves the actual Express/`proxy-addr` resolution behind the hop counts
 * `resolveTrustProxyHops` produces - not just that the number is computed correctly (see
 * trust-proxy.config.spec.ts), but that applying it to `app.set('trust proxy', ...)` makes
 * `req.ip` (what ThrottlerGuard's default tracker reads) behave as intended.
 */
type WhoAmIBody = { ip: string; ips: string[] };

function buildWhoAmIApp(hops: number): express.Express {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/whoami', (req, res) => {
    res.json({ ip: req.ip, ips: req.ips });
  });
  return app;
}

async function getWhoAmI(app: express.Express, forwardedFor?: string): Promise<WhoAmIBody> {
  const pending = request(app).get('/whoami');
  const response = await (forwardedFor ? pending.set('X-Forwarded-For', forwardedFor) : pending);
  return response.body as WhoAmIBody;
}

describe('Express trust proxy behavior at the resolved hop count', () => {
  it('ignores X-Forwarded-For entirely with 0 trusted hops - sane direct/local behavior', async () => {
    const app = buildWhoAmIApp(resolveTrustProxyHops({ NODE_ENV: 'development' }));

    const body = await getWhoAmI(app, '203.0.113.5');

    expect(body.ips).toEqual([]);
    expect(body.ip).not.toBe('203.0.113.5');
  });

  it('resolves the real client from exactly the one trusted hop (Railway production default)', async () => {
    const app = buildWhoAmIApp(resolveTrustProxyHops({ NODE_ENV: 'production' }));

    const body = await getWhoAmI(app, '203.0.113.5');

    expect(body.ip).toBe('203.0.113.5');
  });

  it('does not extend trust past the configured single hop for a client-prepended chain', async () => {
    const app = buildWhoAmIApp(resolveTrustProxyHops({ NODE_ENV: 'production' })); // hops = 1

    // X-Forwarded-For is append-only per hop: "<client-claimed>, <the one trusted proxy's own
    // value>". A malicious client can prepend anything before what actually reaches the
    // trusted proxy; with exactly one trusted hop, Express must take the address the trusted
    // proxy itself appended (rightmost), never the attacker-controlled leftmost entry.
    const body = await getWhoAmI(app, '198.51.100.9, 203.0.113.5');

    expect(body.ip).toBe('203.0.113.5');
    expect(body.ip).not.toBe('198.51.100.9');
  });

  it('falls back to the direct socket peer when trust is configured but no header is present', async () => {
    const app = buildWhoAmIApp(resolveTrustProxyHops({ NODE_ENV: 'production' }));

    const body = await getWhoAmI(app);

    expect(body.ips).toEqual([]);
    expect(typeof body.ip).toBe('string');
    expect(body.ip.length).toBeGreaterThan(0);
  });
});
