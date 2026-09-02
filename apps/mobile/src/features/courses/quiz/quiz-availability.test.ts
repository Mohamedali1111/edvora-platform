import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveQuizAvailabilityPhase } from './quiz-availability';

test('PUBLISHED resolves to the ready phase', () => {
  assert.equal(resolveQuizAvailabilityPhase('PUBLISHED'), 'ready');
});

test('DRAFT resolves to the draft phase', () => {
  assert.equal(resolveQuizAvailabilityPhase('DRAFT'), 'draft');
});

test('ARCHIVED resolves to the honest unavailable phase, not a fabricated distinction', () => {
  assert.equal(resolveQuizAvailabilityPhase('ARCHIVED'), 'unavailable');
});
