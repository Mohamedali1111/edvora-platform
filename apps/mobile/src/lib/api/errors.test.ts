import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, isApiError } from './errors';

test('ApiError carries kind/status/code and is identified by isApiError', () => {
  const error = new ApiError({ kind: 'backend', status: 401, code: 'INVALID_ACCESS_TOKEN', message: 'Access token is invalid.' });

  assert.equal(error.kind, 'backend');
  assert.equal(error.status, 401);
  assert.equal(error.code, 'INVALID_ACCESS_TOKEN');
  assert.equal(error.message, 'Access token is invalid.');
  assert.ok(isApiError(error));
  assert.equal(isApiError(new Error('plain')), false);
  assert.equal(isApiError(null), false);
});
