// Relative (not "@/...") specifically so this pure, dependency-free module can be
// imported directly by error-mapping.test.ts under the plain Node test harness
// (see src/test-runner.ts) without needing a runtime path-alias resolver — "@/"
// aliases are resolved by Metro/tsc's `paths` for the app itself, but a bare
// "@/..." specifier does not resolve under plain `node` without one.
import { ApiError } from '../../lib/api/errors';
import type { TranslationKey } from '@/lib/i18n/translations';

export function mapLoginError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'auth.login.error.network';
    }

    if (error.code === 'INVALID_CREDENTIALS') {
      return 'auth.login.error.INVALID_CREDENTIALS';
    }

    if (error.code === 'ACCOUNT_UNAVAILABLE') {
      return 'auth.login.error.ACCOUNT_UNAVAILABLE';
    }
  }

  return 'auth.login.error.generic';
}

export function mapActivationError(error: unknown): TranslationKey {
  if (error instanceof ApiError) {
    if (error.kind === 'network') {
      return 'auth.activate.error.network';
    }

    if (error.code === 'ACTIVATION_TOKEN_INVALID') {
      return 'auth.activate.error.ACTIVATION_TOKEN_INVALID';
    }

    if (error.code === 'PASSWORD_POLICY_REJECTED') {
      return 'auth.activate.error.PASSWORD_POLICY_REJECTED';
    }
  }

  return 'auth.activate.error.generic';
}
