import assert from 'node:assert/strict';
import test from 'node:test';
import { progressLabelKey } from './progress-labels';

test('every LessonProgressStatus resolves to its own label key', () => {
  assert.equal(progressLabelKey('NOT_STARTED'), 'courses.lesson.progress.NOT_STARTED');
  assert.equal(progressLabelKey('STARTED'), 'courses.lesson.progress.STARTED');
  assert.equal(progressLabelKey('COMPLETED'), 'courses.lesson.progress.COMPLETED');
});
