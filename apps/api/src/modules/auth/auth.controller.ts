import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ActivateAccountDto } from './dto/activate-account.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CompletePasswordResetDto } from './dto/complete-password-reset.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { SessionChannelDto } from './dto/session-channel.dto';
import type { AuthenticatedSessionResult, SessionChannel } from './types/auth.types';
import { AuthOrchestrationService } from './services/auth-orchestration.service';
import { ClockService } from './services/clock.service';
import { AccessTokenGuard } from './http/access-token.guard';
import { AuthCookieService } from './http/auth-cookie.service';
import { invalidAuthTransport } from './http/auth-http.errors';
import { CurrentAuth } from './http/current-auth.decorator';
import type { AuthenticatedPrincipal } from './http/authenticated-principal';
import { RequireTrustedWebOrigin, TrustedOriginGuard } from './http/trusted-origin.guard';
import { setNoStore } from './http/no-store';

type AuthenticatedSessionResponse = {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  user: {
    id: string;
    role: string;
  };
};

const AUTH_THROTTLE = {
  auth: {
    limit: 5,
    ttl: 60_000,
  },
} as const;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthOrchestrationService,
    private readonly cookies: AuthCookieService,
    private readonly clock: ClockService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedSessionResponse> {
    setNoStore(response);

    const result = await this.auth.login({
      email: body.email,
      password: body.password,
      channel: body.channel,
    });

    if (body.channel === SessionChannelDto.WEB) {
      this.cookies.setWebRefreshCookies(response, result);
      return this.toSessionResponse(result, 'WEB');
    }

    return this.toSessionResponse(result, 'MOBILE');
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async refresh(
    @Body() body: RefreshSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedSessionResponse> {
    setNoStore(response);

    const input =
      body.channel === SessionChannelDto.WEB
        ? this.getWebRefreshInput(body, request)
        : this.getMobileRefreshInput(body);

    try {
      const result = await this.auth.refreshAuthenticatedSession(input);

      if (body.channel === SessionChannelDto.WEB) {
        this.cookies.setWebRefreshCookies(response, result);
        return this.toSessionResponse(result, 'WEB');
      }

      return this.toSessionResponse(result, 'MOBILE');
    } catch (error: unknown) {
      if (body.channel === SessionChannelDto.WEB) {
        this.cookies.clearWebRefreshCookies(response);
      }

      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard, AccessTokenGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async logout(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setNoStore(response);

    await this.auth.logout({ userId: principal.userId, sessionId: principal.sessionId });

    if (this.cookies.hasWebRefreshCookie(request)) {
      this.cookies.clearWebRefreshCookies(response);
    }
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard, AccessTokenGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async logoutAll(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setNoStore(response);

    await this.auth.logoutAll({ userId: principal.userId });

    if (this.cookies.hasWebRefreshCookie(request)) {
      this.cookies.clearWebRefreshCookies(response);
    }
  }

  @Post('activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  async activate(
    @Body() body: ActivateAccountDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setNoStore(response);

    await this.auth.activateAccount({
      activationToken: body.activationToken,
      expectedPurpose: body.purpose,
      newPassword: body.newPassword,
    });
  }

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard, AccessTokenGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedSessionResponse> {
    setNoStore(response);

    const result = await this.auth.changePassword({
      userId: principal.userId,
      currentSessionId: principal.sessionId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    const transport = this.isWebRequest(request) ? 'WEB' : 'MOBILE';

    if (transport === 'WEB') {
      this.cookies.setWebRefreshCookies(response, result);
    }

    return this.toSessionResponse(result, transport);
  }

  @Post('password/reset/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard, TrustedOriginGuard)
  @RequireTrustedWebOrigin()
  @Throttle(AUTH_THROTTLE)
  async completePasswordReset(
    @Body() body: CompletePasswordResetDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    setNoStore(response);

    await this.auth.completePasswordReset({
      resetToken: body.resetToken,
      newPassword: body.newPassword,
    });

    if (this.cookies.hasWebRefreshCookie(request)) {
      this.cookies.clearWebRefreshCookies(response);
    }
  }

  private getWebRefreshInput(
    body: RefreshSessionDto,
    request: Request,
  ): { sessionId: string; refreshToken: string } {
    if (body.refreshToken || body.sessionId) {
      throw invalidAuthTransport();
    }

    const input = this.cookies.getWebRefreshInput(request);

    if (!input) {
      throw invalidAuthTransport();
    }

    return input;
  }

  private getMobileRefreshInput(body: RefreshSessionDto): { sessionId: string; refreshToken: string } {
    if (!body.refreshToken || !body.sessionId) {
      throw invalidAuthTransport();
    }

    return {
      sessionId: body.sessionId,
      refreshToken: body.refreshToken,
    };
  }

  private isWebRequest(request: Request): boolean {
    const origin = request.headers.origin;

    return typeof origin === 'string' || this.cookies.hasWebRefreshCookie(request);
  }

  private toSessionResponse(
    session: AuthenticatedSessionResult,
    channel: SessionChannel,
  ): AuthenticatedSessionResponse {
    const response: AuthenticatedSessionResponse = {
      accessToken: session.accessToken,
      accessTokenExpiresAt: new Date(
        this.clock.now().getTime() + session.accessTokenTtlSeconds * 1_000,
      ).toISOString(),
      sessionId: session.sessionId,
      user: {
        id: session.user.userId,
        role: session.user.platformRole,
      },
    };

    if (channel === 'MOBILE') {
      response.refreshToken = session.refreshToken;
      response.refreshTokenExpiresAt = session.refreshTokenExpiresAt.toISOString();
    }

    return response;
  }
}
