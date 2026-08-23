import { JwtService } from '@nestjs/jwt';
import { PlatformRole } from '../../../../.generated/prisma/client';
import { ExpiredAccessTokenError, InvalidAccessTokenError } from '../errors/auth.errors';
import { testAuthConfig } from '../test-helpers';
import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  const jwtService = new JwtService();
  const service = new AccessTokenService(jwtService, testAuthConfig);

  it('signs and verifies minimal HS256 access tokens', async () => {
    const token = await service.sign({
      userId: '00000000-0000-7000-8000-000000000001',
      sessionId: '00000000-0000-7000-8000-000000000002',
      platformRole: PlatformRole.STUDENT,
    });

    expect(readJwtAlgorithm(token)).toBe('HS256');

    const payload = await service.verify(token);
    expect(payload.sub).toBe('00000000-0000-7000-8000-000000000001');
    expect(payload.sid).toBe('00000000-0000-7000-8000-000000000002');
    expect(payload.role).toBe(PlatformRole.STUDENT);
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sid', 'sub']);
  });

  it('rejects expired, wrong issuer, wrong audience, and tampered tokens', async () => {
    const expired = await jwtService.signAsync(
      { sub: 'user', sid: 'session', role: PlatformRole.STUDENT },
      {
        secret: testAuthConfig.jwt.secret,
        algorithm: 'HS256',
        expiresIn: -1,
        issuer: testAuthConfig.jwt.issuer,
        audience: testAuthConfig.jwt.audience,
      },
    );
    await expect(service.verify(expired)).rejects.toBeInstanceOf(ExpiredAccessTokenError);

    const wrongIssuer = await jwtService.signAsync(
      { sub: 'user', sid: 'session', role: PlatformRole.STUDENT },
      {
        secret: testAuthConfig.jwt.secret,
        algorithm: 'HS256',
        expiresIn: 600,
        issuer: 'wrong-issuer',
        audience: testAuthConfig.jwt.audience,
      },
    );
    await expect(service.verify(wrongIssuer)).rejects.toBeInstanceOf(InvalidAccessTokenError);

    const wrongAudience = await jwtService.signAsync(
      { sub: 'user', sid: 'session', role: PlatformRole.STUDENT },
      {
        secret: testAuthConfig.jwt.secret,
        algorithm: 'HS256',
        expiresIn: 600,
        issuer: testAuthConfig.jwt.issuer,
        audience: 'wrong-audience',
      },
    );
    await expect(service.verify(wrongAudience)).rejects.toBeInstanceOf(InvalidAccessTokenError);

    await expect(service.verify(`${wrongAudience.slice(0, -1)}x`)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects incorrect algorithms and unwanted authorization or PII claims', async () => {
    const noneToken = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: 'user',
          sid: 'session',
          role: PlatformRole.STUDENT,
          iss: testAuthConfig.jwt.issuer,
          aud: testAuthConfig.jwt.audience,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString('base64url'),
      '',
    ].join('.');

    await expect(service.verify(noneToken)).rejects.toBeInstanceOf(InvalidAccessTokenError);

    const tokenWithTenant = await jwtService.signAsync(
      { sub: 'user', sid: 'session', role: PlatformRole.STUDENT, tenantIds: ['tenant'] },
      {
        secret: testAuthConfig.jwt.secret,
        algorithm: 'HS256',
        expiresIn: 600,
        issuer: testAuthConfig.jwt.issuer,
        audience: testAuthConfig.jwt.audience,
      },
    );
    await expect(service.verify(tokenWithTenant)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });
});

function readJwtAlgorithm(token: string): string | undefined {
  const [encodedHeader] = token.split('.');

  if (!encodedHeader) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));

  if (typeof parsed !== 'object' || parsed === null || !('alg' in parsed)) {
    return undefined;
  }

  const algorithm = parsed.alg;

  return typeof algorithm === 'string' ? algorithm : undefined;
}
