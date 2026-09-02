import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDurationSeconds, formatFileSize } from './format';

test('formatDurationSeconds renders mm:ss and hh:mm:ss', () => {
  assert.equal(formatDurationSeconds(0), '0:00');
  assert.equal(formatDurationSeconds(65), '1:05');
  assert.equal(formatDurationSeconds(3661), '1:01:01');
});

test('formatDurationSeconds returns null for a missing/invalid duration (still-processing video)', () => {
  assert.equal(formatDurationSeconds(null), null);
  assert.equal(formatDurationSeconds(-5), null);
  assert.equal(formatDurationSeconds(Number.NaN), null);
});

test('formatFileSize renders human-readable units', () => {
  assert.equal(formatFileSize('0'), '0 B');
  assert.equal(formatFileSize('512'), '512 B');
  assert.equal(formatFileSize('2048'), '2.0 KB');
  assert.equal(formatFileSize('5242880'), '5.0 MB');
});

test('formatFileSize falls back to the raw string for a non-numeric value rather than crashing', () => {
  assert.equal(formatFileSize('not-a-number'), 'not-a-number');
});
