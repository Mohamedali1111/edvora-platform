import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPTURE_WARNING_DISMISSED,
  shouldDismissCaptureWarning,
  shouldPauseForAppState,
  triggerCaptureWarning,
} from './capture-state';

test('CAPTURE_WARNING_DISMISSED starts hidden', () => {
  assert.equal(CAPTURE_WARNING_DISMISSED.visible, false);
});

test('triggerCaptureWarning becomes visible and records when it started', () => {
  const state = triggerCaptureWarning(1000);
  assert.equal(state.visible, true);
  assert.equal(state.sinceMs, 1000);
});

test('shouldDismissCaptureWarning stays false before the display duration elapses', () => {
  const state = triggerCaptureWarning(1000);
  assert.equal(shouldDismissCaptureWarning(state, 1000), false);
  assert.equal(shouldDismissCaptureWarning(state, 4999), false);
});

test('shouldDismissCaptureWarning becomes true once the display duration elapses', () => {
  const state = triggerCaptureWarning(1000);
  assert.equal(shouldDismissCaptureWarning(state, 5000), true);
  assert.equal(shouldDismissCaptureWarning(state, 9999), true);
});

test('shouldDismissCaptureWarning is false for an already-dismissed state', () => {
  assert.equal(shouldDismissCaptureWarning(CAPTURE_WARNING_DISMISSED, 999_999), false);
});

test('shouldPauseForAppState pauses for anything but "active"', () => {
  assert.equal(shouldPauseForAppState('active'), false);
  assert.equal(shouldPauseForAppState('background'), true);
  assert.equal(shouldPauseForAppState('inactive'), true);
  assert.equal(shouldPauseForAppState('some-future-state'), true);
});
