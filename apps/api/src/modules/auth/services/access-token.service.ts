import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthRuntimeConfig } from '../auth.config';
import { AUTH_RUNTIME_CONFIG } from '../auth.constants';
import { ExpiredAccessTokenError, InvalidAccessTokenError } from '../errors/auth.errors';
import type { AccessTokenPayload, SignAccessTokenInput } from '../types/auth.types';

const SENSITIVE_OR_AUTHORIZATION_CLAIMS = [
  'email',
  'name',
  'tenantId',
  'tenantIds',
  'memberships',
  'courseIds',
  'enrollments',
  'permissions',
  'deviceSecret',
  'refreshToken',
  'password',
] as const;

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_RUNTIME_CONFIG)
    private readonly config: AuthRuntimeConfig,
  ) {}

  async sign(input: SignAccessTokenInput): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: input.userId,
        sid: input.sessionId,
        role: input.platformRole,
      },
      {
        secret: this.config.jwt.secret,
        algorithm: 'HS256',
        expiresIn: this.config.jwt.accessTokenTtlSeconds,
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      },
    );
  }

  async verify(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwt.secret,
        algorithms: ['HS256'],
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });

      this.assertMinimalPayload(payload);

      return payload;
    } catch (error: unknown) {
      if (isTokenExpiredError(error)) {
        throw new ExpiredAccessTokenError();
      }

      throw new InvalidAccessTokenError();
    }
  }

  private assertMinimalPayload(payload: AccessTokenPayload): void {
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.iss !== this.config.jwt.issuer ||
      payload.aud !== this.config.jwt.audience
    ) {
      throw new InvalidAccessTokenError();
    }

    for (const claim of SENSITIVE_OR_AUTHORIZATION_CLAIMS) {
      if (Object.prototype.hasOwnProperty.call(payload, claim)) {
        throw new InvalidAccessTokenError();
      }
    }
  }
}

function isTokenExpiredError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TokenExpiredError';
}
