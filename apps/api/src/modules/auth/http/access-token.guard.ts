import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PlatformRole } from '../../../../.generated/prisma/client';
import { InvalidAccessTokenError } from '../errors/auth.errors';
import { AccessTokenService } from '../services/access-token.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    const payload = await this.accessTokens.verify(token);

    if (!Object.values(PlatformRole).includes(payload.role)) {
      throw new InvalidAccessTokenError();
    }

    request.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
      platformRole: payload.role,
    };

    return true;
  }
}

function extractBearerToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string') {
    throw new InvalidAccessTokenError();
  }

  const parts = value.trim().split(/\s+/);

  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    throw new InvalidAccessTokenError();
  }

  return parts[1];
}
