import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../lib/api/errors';
import { mapCourseContentError } from './error-mapping';

test('mapCourseContentError maps COURSE_NOT_FOUND and LESSON_NOT_FOUND to honest, distinct copy', () => {
  assert.equal(
    mapCourseContentError(new ApiError({ kind: 'backend', code: 'COURSE_NOT_FOUND', message: 'x' })),
    'courses.error.courseNotFound',
  );
  assert.equal(
    mapCourseContentError(new ApiError({ kind: 'backend', code: 'LESSON_NOT_FOUND', message: 'x' })),
    'courses.error.lessonNotFound',
  );
});

test('mapCourseContentError maps a network failure and falls back safely for anything else', () => {
  assert.equal(mapCourseContentError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })), 'courses.error.network');
  assert.equal(mapCourseContentError(new ApiError({ kind: 'backend', code: 'SOME_OTHER_CODE', message: 'x' })), 'courses.error.generic');
  assert.equal(mapCourseContentError(new Error('not an ApiError')), 'courses.error.generic');
});
