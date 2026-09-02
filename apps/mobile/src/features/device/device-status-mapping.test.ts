import assert from 'node:assert/strict';
import test from 'node:test';
import { toUiStatus } from './device-status-mapping';

test('AUTHORIZED and CHANGE_PENDING map straight through', () => {
  assert.equal(toUiStatus('AUTHORIZED'), 'authorized');
  assert.equal(toUiStatus('CHANGE_PENDING'), 'change_pending');
});

// The core regression guard for Blocker 2: the backend has no REJECTED wire
// status (see device-status-mapping.ts's doc comment), and this mapping must
// never invent one. Every non-AUTHORIZED, non-CHANGE_PENDING wire value —
// including CHANGE_REQUIRED immediately after an admin rejection, which is
// wire-identical to a CHANGE_REQUIRED that was never rejected — collapses to
// the same neutral 'change_required' UI state, with no history-based branching.
test('CHANGE_REQUIRED never becomes a fabricated rejected state', () => {
  assert.equal(toUiStatus('CHANGE_REQUIRED'), 'change_required');
});

test('NO_DEVICE_REGISTERED falls back to the same neutral state (defensive; evaluate() normally intercepts this first)', () => {
  assert.equal(toUiStatus('NO_DEVICE_REGISTERED'), 'change_required');
});

test('the mapping never produces a status outside the known DeviceUiStatus set', () => {
  const inputs = ['AUTHORIZED', 'CHANGE_PENDING', 'CHANGE_REQUIRED', 'NO_DEVICE_REGISTERED'] as const;
  const allowed = new Set(['authorized', 'change_pending', 'change_required']);

  for (const input of inputs) {
    assert.ok(allowed.has(toUiStatus(input)), `unexpected UI status for wire input "${input}"`);
  }
});
