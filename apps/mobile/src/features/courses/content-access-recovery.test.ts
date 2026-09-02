import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyContentAccessError } from './content-access-recovery';

test('session-invalidity codes route back through the auth state machine', () => {
  for (const code of ['INVALID_ACCESS_TOKEN', 'EXPIRED_ACCESS_TOKEN', 'INVALID_REFRESH_SESSION', 'ACCOUNT_UNAVAILABLE', 'STUDENT_REQUIRED']) {
    assert.equal(classifyContentAccessError(code), 'auth', `expected "${code}" to trigger auth recovery`);
  }
});

test('device-invalidity codes route back through the device state machine', () => {
  for (const code of ['DEVICE_NOT_AUTHORIZED', 'DEVICE_INSTALLATION_ID_REQUIRED', 'DEVICE_INSTALLATION_ID_INVALID', 'ACCOUNT_INACTIVE']) {
    assert.equal(classifyContentAccessError(code), 'device', `expected "${code}" to trigger device recovery`);
  }
});

test('a genuine content-scoped rejection triggers neither state machine', () => {
  assert.equal(classifyContentAccessError('COURSE_NOT_FOUND'), 'none');
  assert.equal(classifyContentAccessError('LESSON_NOT_FOUND'), 'none');
  assert.equal(classifyContentAccessError('NETWORK_UNAVAILABLE'), 'none');
});
