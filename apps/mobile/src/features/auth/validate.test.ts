import assert from 'node:assert/strict';
import test from 'node:test';
import { validateActivationInput, validateLoginInput } from './validate';

test('validateLoginInput requires and validates email/password', () => {
  assert.deepEqual(validateLoginInput('', ''), { email: 'required', password: 'required' });
  assert.deepEqual(validateLoginInput('not-an-email', 'x'), { email: 'invalid' });
  assert.deepEqual(validateLoginInput('student@example.com', 'x'), {});
});

test('validateActivationInput requires an explicitly entered activation token', () => {
  const errors = validateActivationInput({ activationToken: '', newPassword: 'a-long-enough-password', confirmPassword: 'a-long-enough-password' });
  assert.deepEqual(errors, { activationToken: 'required' });
});

test('validateActivationInput treats a whitespace-only token as missing (no implicit default source)', () => {
  const errors = validateActivationInput({ activationToken: '   ', newPassword: 'a-long-enough-password', confirmPassword: 'a-long-enough-password' });
  assert.equal(errors.activationToken, 'required');
});

test('validateActivationInput enforces the password policy and confirmation match', () => {
  assert.deepEqual(
    validateActivationInput({ activationToken: 'tok', newPassword: 'short', confirmPassword: 'short' }),
    { newPassword: 'tooShort' },
  );
  assert.deepEqual(
    validateActivationInput({ activationToken: 'tok', newPassword: 'a-long-enough-password', confirmPassword: 'different-password' }),
    { confirmPassword: 'mismatch' },
  );
  assert.deepEqual(
    validateActivationInput({ activationToken: 'tok', newPassword: 'a-long-enough-password', confirmPassword: 'a-long-enough-password' }),
    {},
  );
});
