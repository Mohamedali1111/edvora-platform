export type PlatformAdminBootstrapErrorCode =
  | 'BOOTSTRAP_EMAIL_REQUIRED'
  | 'BOOTSTRAP_EMAIL_INVALID'
  | 'BOOTSTRAP_PASSWORD_REQUIRED'
  | 'BOOTSTRAP_ADMIN_CONFLICT';

/**
 * Base type for every error this bootstrap tool throws on purpose. Every message on every
 * subclass below is a fixed, hand-written string that never interpolates the attempted email
 * or password - safe to print to the operator's terminal as-is. Anything that is *not* an
 * instance of this class (or of the application's own `AuthError`, e.g. a password-policy
 * rejection) is treated by the CLI entrypoint as unknown/unsafe and reported generically.
 */
export class PlatformAdminBootstrapError extends Error {
  constructor(
    readonly code: PlatformAdminBootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformAdminBootstrapError';
  }
}

export class BootstrapEmailRequiredError extends PlatformAdminBootstrapError {
  constructor() {
    super('BOOTSTRAP_EMAIL_REQUIRED', 'PLATFORM_ADMIN_BOOTSTRAP_EMAIL is required.');
    this.name = 'BootstrapEmailRequiredError';
  }
}

export class BootstrapEmailInvalidError extends PlatformAdminBootstrapError {
  constructor() {
    super('BOOTSTRAP_EMAIL_INVALID', 'PLATFORM_ADMIN_BOOTSTRAP_EMAIL must be a valid email address.');
    this.name = 'BootstrapEmailInvalidError';
  }
}

export class BootstrapPasswordRequiredError extends PlatformAdminBootstrapError {
  constructor() {
    super('BOOTSTRAP_PASSWORD_REQUIRED', 'PLATFORM_ADMIN_BOOTSTRAP_PASSWORD is required.');
    this.name = 'BootstrapPasswordRequiredError';
  }
}

/**
 * A PLATFORM_ADMIN already exists with a different normalized email than the one requested.
 * This tool only ever creates the *first* platform admin - see docs/DEPLOYMENT.md - and
 * refuses to create a second one by default rather than silently permitting multiple initial
 * admins.
 */
export class PlatformAdminAlreadyExistsError extends PlatformAdminBootstrapError {
  constructor() {
    super(
      'BOOTSTRAP_ADMIN_CONFLICT',
      'A platform admin already exists with a different email. Refusing to create a second one.',
    );
    this.name = 'PlatformAdminAlreadyExistsError';
  }
}
