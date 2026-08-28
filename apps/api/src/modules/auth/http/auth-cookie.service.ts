import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthHttpConfig } from './auth-http.config';
import { AUTH_HTTP_CONFIG } from './auth-http.constants';
import type { AuthenticatedSessionResult } from '../types/auth.types';
import { ClockService } from '../services/clock.service';

@Injectable()
export class AuthCookieService {
  constructor(
    @Inject(AUTH_HTTP_CONFIG)
    private readonly config: AuthHttpConfig,
    private readonly clock: ClockService,
  ) {}

  setWebRefreshCookies(response: Response, session: AuthenticatedSessionResult): void {
    const options = this.cookieOptions(session.refreshTokenExpiresAt);

    response.cookie(this.config.cookies.refreshTokenName, session.refreshToken, options);
    response.cookie(this.config.cookies.sessionIdName, session.sessionId, options);
  }

  clearWebRefreshCookies(response: Response): void {
    const options = this.clearCookieOptions();

    response.clearCookie(this.config.cookies.refreshTokenName, options);
    response.clearCookie(this.config.cookies.sessionIdName, options);
  }

  getWebRefreshInput(request: Request): { sessionId: string; refreshToken: string } | null {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const refreshToken = cookies?.[this.config.cookies.refreshTokenName];
    const sessionId = cookies?.[this.config.cookies.sessionIdName];

    if (!refreshToken || !sessionId) {
      return null;
    }

    return { sessionId, refreshToken };
  }

  hasWebRefreshCookie(request: Request): boolean {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;

    return Boolean(
      cookies?.[this.config.cookies.refreshTokenName] ||
        cookies?.[this.config.cookies.sessionIdName],
    );
  }

  private cookieOptions(expires: Date) {
    return {
      httpOnly: this.config.cookies.httpOnly,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      path: this.config.cookies.path,
      expires,
      maxAge: Math.max(0, expires.getTime() - this.clock.now().getTime()),
    } as const;
  }

  private clearCookieOptions() {
    return {
      httpOnly: this.config.cookies.httpOnly,
      secure: this.config.cookies.secure,
      sameSite: this.config.cookies.sameSite,
      path: this.config.cookies.path,
    } as const;
  }
}
