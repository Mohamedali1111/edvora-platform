import { BadRequestException, ForbiddenException } from '@nestjs/common';

export function invalidAuthTransport(): BadRequestException {
  return new BadRequestException({
    error: {
      code: 'INVALID_AUTH_TRANSPORT',
      message: 'Invalid authentication transport.',
    },
  });
}

export function invalidTrustedOrigin(): ForbiddenException {
  return new ForbiddenException({
    error: {
      code: 'CSRF_ORIGIN_INVALID',
      message: 'Origin is not allowed for this authentication request.',
    },
  });
}
