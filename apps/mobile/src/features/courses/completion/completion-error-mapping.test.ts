import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../../lib/api/errors';
import { mapCompletionError } from './completion-error-mapping';

test('mapCompletionError maps COURSE_NOT_FOUND and LESSON_NOT_FOUND to the same honest "not available" copy', () => {
  assert.equal(
    mapCompletionError(new ApiError({ kind: 'backend', code: 'COURSE_NOT_FOUND', message: 'x' })),
    'courses.completion.error.notAvailable',
  );
  assert.equal(
    mapCompletionError(new ApiError({ kind: 'backend', code: 'LESSON_NOT_FOUND', message: 'x' })),
    'courses.completion.error.notAvailable',
  );
});

test('mapCompletionError maps QUIZ_LESSON_COMPLETION_NOT_ALLOWED distinctly (defense in depth — unreachable from the QUIZ screen)', () => {
  assert.equal(
    mapCompletionError(new ApiError({ kind: 'backend', code: 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED', message: 'x' })),
    'courses.completion.error.notAllowed',
  );
});

test('mapCompletionError maps network failures and falls back safely for anything else', () => {
  assert.equal(
    mapCompletionError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })),
    'courses.completion.error.network',
  );
  assert.equal(
    mapCompletionError(new ApiError({ kind: 'backend', code: 'SOME_OTHER_CODE', message: 'x' })),
    'courses.completion.error.generic',
  );
  assert.equal(mapCompletionError(new Error('not an ApiError')), 'courses.completion.error.generic');
});
