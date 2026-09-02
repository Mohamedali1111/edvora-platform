import assert from 'node:assert/strict';
import test from 'node:test';
import { isCapabilityExpired, needsRefreshOnForegroundResume } from './playback-expiry';

test('isCapabilityExpired is false before expiry and true at/after it', () => {
  const expiresAt = '2026-01-01T00:10:00.000Z';
  const before = Date.parse('2026-01-01T00:09:59.000Z');
  const atExpiry = Date.parse(expiresAt);
  const after = Date.parse('2026-01-01T00:10:01.000Z');

  assert.equal(isCapabilityExpired(expiresAt, before), false);
  assert.equal(isCapabilityExpired(expiresAt, atExpiry), true);
  assert.equal(isCapabilityExpired(expiresAt, after), true);
});

test('isCapabilityExpired treats an unparseable expiry as already expired (fail safe, not fail open)', () => {
  assert.equal(isCapabilityExpired('not-a-date', Date.now()), true);
});

test('needsRefreshOnForegroundResume applies a safety margin before the real expiry', () => {
  const expiresAt = '2026-01-01T00:10:00.000Z';
  const wellBefore = Date.parse('2026-01-01T00:05:00.000Z');
  const withinMargin = Date.parse('2026-01-01T00:09:45.000Z'); // 15s before expiry, margin is 30s
  const after = Date.parse('2026-01-01T00:10:01.000Z');

  assert.equal(needsRefreshOnForegroundResume(expiresAt, wellBefore), false);
  assert.equal(needsRefreshOnForegroundResume(expiresAt, withinMargin), true);
  assert.equal(needsRefreshOnForegroundResume(expiresAt, after), true);
});

test('needsRefreshOnForegroundResume treats an unparseable expiry as needing refresh', () => {
  assert.equal(needsRefreshOnForegroundResume('garbage', Date.now()), true);
});
