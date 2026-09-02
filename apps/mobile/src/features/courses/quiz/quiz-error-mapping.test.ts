import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../../lib/api/errors';
import { mapQuizError } from './quiz-error-mapping';

function backendError(code: string) {
  return new ApiError({ kind: 'backend', code, message: 'x' });
}

test('mapQuizError maps LESSON_NOT_FOUND to the honest "not available" copy', () => {
  assert.equal(mapQuizError(backendError('LESSON_NOT_FOUND')), 'quiz.error.notAvailable');
});

test('mapQuizError maps quiz/attempt-specific codes to distinct copy', () => {
  assert.equal(mapQuizError(backendError('QUIZ_HAS_NO_ACTIVE_QUESTIONS')), 'quiz.error.noQuestions');
  assert.equal(mapQuizError(backendError('QUIZ_ATTEMPT_LIMIT_REACHED')), 'quiz.error.attemptLimitReached');
  assert.equal(mapQuizError(backendError('QUIZ_ATTEMPT_NOT_OPEN')), 'quiz.error.attemptNotOpen');
  assert.equal(mapQuizError(backendError('QUIZ_ATTEMPT_NOT_FOUND')), 'quiz.error.attemptNotFound');
});

test('mapQuizError maps both invalid-answer codes to the same copy', () => {
  assert.equal(mapQuizError(backendError('QUESTION_NOT_FOUND')), 'quiz.error.invalidAnswer');
  assert.equal(mapQuizError(backendError('QUESTION_OPTION_NOT_FOUND')), 'quiz.error.invalidAnswer');
});

test('mapQuizError maps network failures and falls back safely for anything else', () => {
  assert.equal(mapQuizError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })), 'quiz.error.network');
  assert.equal(mapQuizError(backendError('SOME_OTHER_CODE')), 'quiz.error.generic');
  assert.equal(mapQuizError(new Error('not an ApiError')), 'quiz.error.generic');
});
