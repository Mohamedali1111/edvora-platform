import { HttpStatus } from '@nestjs/common';
import { AuthError } from '../errors/auth.errors';

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

const TOKEN_ERROR_CODES = new Set([
  'ACTIVATION_TOKEN_INVALID',
  'ACTIVATION_TOKEN_EXPIRED',
  'ACTIVATION_TOKEN_CONSUMED',
  'RESET_TOKEN_INVALID',
  'RESET_TOKEN_EXPIRED',
  'RESET_TOKEN_CONSUMED',
]);

export function mapAuthErrorToHttp(error: AuthError): { status: number; body: ErrorResponseBody } {
  if (error.code === 'INVALID_CREDENTIALS') {
    return authError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Invalid credentials.');
  }

  if (error.code === 'INVALID_ACCESS_TOKEN' || error.code === 'EXPIRED_ACCESS_TOKEN') {
    return authError(HttpStatus.UNAUTHORIZED, 'INVALID_ACCESS_TOKEN', 'Access token is invalid.');
  }

  if (error.code === 'INVALID_REFRESH_SESSION' || error.code === 'REFRESH_REPLAY_DETECTED') {
    return authError(HttpStatus.UNAUTHORIZED, 'INVALID_REFRESH_SESSION', 'Refresh session is invalid.');
  }

  if (error.code === 'ACCOUNT_INACTIVE') {
    return authError(HttpStatus.FORBIDDEN, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable.');
  }

  if (TOKEN_ERROR_CODES.has(error.code)) {
    const code = error.code.startsWith('ACTIVATION')
      ? 'ACTIVATION_TOKEN_INVALID'
      : 'RESET_TOKEN_INVALID';

    return authError(HttpStatus.BAD_REQUEST, code, 'Token is invalid.');
  }

  if (error.code === 'PASSWORD_POLICY_REJECTED') {
    return authError(HttpStatus.BAD_REQUEST, 'PASSWORD_POLICY_REJECTED', error.message);
  }

  if (error.code === 'CURRENT_PASSWORD_INCORRECT') {
    return authError(HttpStatus.BAD_REQUEST, 'CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect.');
  }

  if (error.code === 'NEW_PASSWORD_SAME_AS_CURRENT') {
    return authError(HttpStatus.BAD_REQUEST, 'NEW_PASSWORD_SAME_AS_CURRENT', 'New password must be different.');
  }

  return authError(HttpStatus.BAD_REQUEST, error.code, 'Authentication request failed.');
}

function authError(status: number, code: string, message: string): { status: number; body: ErrorResponseBody } {
  return {
    status,
    body: {
      error: {
        code,
        message,
      },
    },
  };
}
