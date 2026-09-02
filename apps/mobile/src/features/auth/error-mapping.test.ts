import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../lib/api/errors';
import { mapActivationError, mapLoginError } from './error-mapping';

test('mapLoginError maps known backend codes and falls back safely', () => {
  assert.equal(
    mapLoginError(new ApiError({ kind: 'backend', code: 'INVALID_CREDENTIALS', message: 'x' })),
    'auth.login.error.INVALID_CREDENTIALS',
  );
  assert.equal(
    mapLoginError(new ApiError({ kind: 'backend', code: 'ACCOUNT_UNAVAILABLE', message: 'x' })),
    'auth.login.error.ACCOUNT_UNAVAILABLE',
  );
  assert.equal(mapLoginError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })), 'auth.login.error.network');
  assert.equal(mapLoginError(new ApiError({ kind: 'backend', code: 'SOMETHING_ELSE', message: 'x' })), 'auth.login.error.generic');
  assert.equal(mapLoginError(new Error('not an ApiError')), 'auth.login.error.generic');
});

test('mapActivationError maps known backend codes and never echoes the raw error message/token', () => {
  const key = mapActivationError(new ApiError({ kind: 'backend', code: 'ACTIVATION_TOKEN_INVALID', message: 'contains-a-secret-token-value' }));
  assert.equal(key, 'auth.activate.error.ACTIVATION_TOKEN_INVALID');
  // The mapper returns a translation KEY, never the backend's raw message — so a
  // token accidentally echoed in a backend error message can never surface here.
  assert.ok(!key.includes('secret'));

  assert.equal(
    mapActivationError(new ApiError({ kind: 'backend', code: 'PASSWORD_POLICY_REJECTED', message: 'x' })),
    'auth.activate.error.PASSWORD_POLICY_REJECTED',
  );
  assert.equal(mapActivationError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })), 'auth.activate.error.network');
  assert.equal(mapActivationError(new Error('not an ApiError')), 'auth.activate.error.generic');
});
