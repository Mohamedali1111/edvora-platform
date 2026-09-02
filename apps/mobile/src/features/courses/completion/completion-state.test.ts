import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialCompletionState,
  reduceCompletionEvent,
  shouldAttemptCompletion,
  type CompletionState,
} from './completion-state';

test('initialCompletionState starts idle when the lesson was not already COMPLETED', () => {
  assert.deepEqual(initialCompletionState(false), { phase: 'idle', errorKey: null });
});

test('initialCompletionState starts saved (already-completed behavior) when Course Detail already shows COMPLETED', () => {
  assert.deepEqual(initialCompletionState(true), { phase: 'saved', errorKey: null });
});

test('reduceCompletionEvent: trigger moves idle -> saving', () => {
  const state = reduceCompletionEvent({ phase: 'idle', errorKey: null }, { type: 'trigger' });
  assert.deepEqual(state, { phase: 'saving', errorKey: null });
});

test('reduceCompletionEvent: trigger is a no-op duplicate-suppression guard while saving', () => {
  const saving: CompletionState = { phase: 'saving', errorKey: null };
  assert.equal(reduceCompletionEvent(saving, { type: 'trigger' }), saving);
});

test('reduceCompletionEvent: trigger is a no-op once already saved (already-completed behavior never re-attempts)', () => {
  const saved: CompletionState = { phase: 'saved', errorKey: null };
  assert.equal(reduceCompletionEvent(saved, { type: 'trigger' }), saved);
});

test('reduceCompletionEvent: trigger from an error state re-attempts (this is the retry action)', () => {
  const errored: CompletionState = { phase: 'error', errorKey: 'courses.completion.error.generic' };
  assert.deepEqual(reduceCompletionEvent(errored, { type: 'trigger' }), { phase: 'saving', errorKey: null });
});

test('reduceCompletionEvent: succeeded moves saving -> saved and clears any error', () => {
  const saving: CompletionState = { phase: 'saving', errorKey: null };
  assert.deepEqual(reduceCompletionEvent(saving, { type: 'succeeded' }), { phase: 'saved', errorKey: null });
});

test('reduceCompletionEvent: failed moves saving -> error carrying the exact mapped errorKey', () => {
  const saving: CompletionState = { phase: 'saving', errorKey: null };
  assert.deepEqual(reduceCompletionEvent(saving, { type: 'failed', errorKey: 'courses.completion.error.notAvailable' }), {
    phase: 'error',
    errorKey: 'courses.completion.error.notAvailable',
  });
});

test('reduceCompletionEvent: ambiguous moves saving -> error with the dedicated "could not confirm" copy, never a definitive-failure copy', () => {
  const saving: CompletionState = { phase: 'saving', errorKey: null };
  assert.deepEqual(reduceCompletionEvent(saving, { type: 'ambiguous' }), {
    phase: 'error',
    errorKey: 'courses.completion.error.ambiguous',
  });
});

test('reduceCompletionEvent: confirmedComplete converges an ambiguous error to saved (post-ambiguity reconciliation)', () => {
  const ambiguous: CompletionState = { phase: 'error', errorKey: 'courses.completion.error.ambiguous' };
  assert.deepEqual(reduceCompletionEvent(ambiguous, { type: 'confirmedComplete' }), { phase: 'saved', errorKey: null });
});

test('shouldAttemptCompletion is true for idle and error, false for saving and saved', () => {
  assert.equal(shouldAttemptCompletion({ phase: 'idle', errorKey: null }), true);
  assert.equal(shouldAttemptCompletion({ phase: 'error', errorKey: 'courses.completion.error.generic' }), true);
  assert.equal(shouldAttemptCompletion({ phase: 'saving', errorKey: null }), false);
  assert.equal(shouldAttemptCompletion({ phase: 'saved', errorKey: null }), false);
});
