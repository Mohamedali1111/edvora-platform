import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthHttpConfig } from './auth-http.config';
import { AUTH_HTTP_CONFIG, TRUSTED_WEB_ORIGIN_REQUIRED } from './auth-http.constants';
import { invalidTrustedOrigin } from './auth-http.errors';

export const RequireTrustedWebOrigin = (): MethodDecorator =>
  SetMetadata(TRUSTED_WEB_ORIGIN_REQUIRED, true);

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_HTTP_CONFIG)
    private readonly config: AuthHttpConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresCheck = this.reflector.getAllAndOverride<boolean>(
      TRUSTED_WEB_ORIGIN_REQUIRED,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (!this.isWebCookieOrWebChannelRequest(request)) {
      return true;
    }

    const origin = request.headers.origin;

    if (typeof origin !== 'string' || !this.config.trustedWebOrigins.includes(origin)) {
      throw invalidTrustedOrigin();
    }

    return true;
  }

  private isWebCookieOrWebChannelRequest(request: Request): boolean {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const body = request.body as { channel?: unknown } | undefined;

    return Boolean(
      body?.channel === 'WEB' ||
        cookies?.[this.config.cookies.refreshTokenName] ||
        cookies?.[this.config.cookies.sessionIdName],
    );
  }
}
