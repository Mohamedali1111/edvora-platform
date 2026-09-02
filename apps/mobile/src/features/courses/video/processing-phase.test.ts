import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVideoProcessingPhase } from './processing-phase';

test('READY resolves to the ready phase', () => {
  assert.equal(resolveVideoProcessingPhase('READY'), 'ready');
});

test('UPLOADING and PROCESSING both resolve to the processing phase', () => {
  assert.equal(resolveVideoProcessingPhase('UPLOADING'), 'processing');
  assert.equal(resolveVideoProcessingPhase('PROCESSING'), 'processing');
});

test('FAILED resolves to the failed phase', () => {
  assert.equal(resolveVideoProcessingPhase('FAILED'), 'failed');
});

test('ARCHIVED resolves to the honest unavailable phase, not a fabricated distinction', () => {
  assert.equal(resolveVideoProcessingPhase('ARCHIVED'), 'unavailable');
});
