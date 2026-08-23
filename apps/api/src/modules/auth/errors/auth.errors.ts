export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'PASSWORD_POLICY_REJECTED'
  | 'INVALID_ACCESS_TOKEN'
  | 'EXPIRED_ACCESS_TOKEN'
  | 'INVALID_REFRESH_SESSION'
  | 'REFRESH_REPLAY_DETECTED'
  | 'ACCOUNT_INACTIVE'
  | 'ACTIVATION_TOKEN_INVALID'
  | 'ACTIVATION_TOKEN_EXPIRED'
  | 'ACTIVATION_TOKEN_CONSUMED'
  | 'RESET_TOKEN_INVALID'
  | 'RESET_TOKEN_EXPIRED'
  | 'RESET_TOKEN_CONSUMED';

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class PasswordPolicyError extends AuthError {
  constructor(message: string) {
    super('PASSWORD_POLICY_REJECTED', message);
    this.name = 'PasswordPolicyError';
  }
}

export class InvalidAccessTokenError extends AuthError {
  constructor() {
    super('INVALID_ACCESS_TOKEN', 'Access token is invalid.');
    this.name = 'InvalidAccessTokenError';
  }
}

export class ExpiredAccessTokenError extends AuthError {
  constructor() {
    super('EXPIRED_ACCESS_TOKEN', 'Access token has expired.');
    this.name = 'ExpiredAccessTokenError';
  }
}

export class InvalidRefreshSessionError extends AuthError {
  constructor() {
    super('INVALID_REFRESH_SESSION', 'Refresh session is invalid.');
    this.name = 'InvalidRefreshSessionError';
  }
}

export class RefreshReplayDetectedError extends AuthError {
  constructor() {
    super('REFRESH_REPLAY_DETECTED', 'Refresh token replay was detected.');
    this.name = 'RefreshReplayDetectedError';
  }
}

export class AccountInactiveError extends AuthError {
  constructor() {
    super('ACCOUNT_INACTIVE', 'Account is not active.');
    this.name = 'AccountInactiveError';
  }
}

export class ActivationTokenInvalidError extends AuthError {
  constructor() {
    super('ACTIVATION_TOKEN_INVALID', 'Activation token is invalid.');
    this.name = 'ActivationTokenInvalidError';
  }
}

export class ActivationTokenExpiredError extends AuthError {
  constructor() {
    super('ACTIVATION_TOKEN_EXPIRED', 'Activation token has expired.');
    this.name = 'ActivationTokenExpiredError';
  }
}

export class ActivationTokenConsumedError extends AuthError {
  constructor() {
    super('ACTIVATION_TOKEN_CONSUMED', 'Activation token has already been consumed.');
    this.name = 'ActivationTokenConsumedError';
  }
}

export class ResetTokenInvalidError extends AuthError {
  constructor() {
    super('RESET_TOKEN_INVALID', 'Password reset token is invalid.');
    this.name = 'ResetTokenInvalidError';
  }
}

export class ResetTokenExpiredError extends AuthError {
  constructor() {
    super('RESET_TOKEN_EXPIRED', 'Password reset token has expired.');
    this.name = 'ResetTokenExpiredError';
  }
}

export class ResetTokenConsumedError extends AuthError {
  constructor() {
    super('RESET_TOKEN_CONSUMED', 'Password reset token has already been consumed.');
    this.name = 'ResetTokenConsumedError';
  }
}
