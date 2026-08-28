import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal } from './authenticated-principal';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth) {
      throw new Error('Authenticated principal is missing from the request.');
    }

    return request.auth;
  },
);
