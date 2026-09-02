import assert from 'node:assert/strict';
import test from 'node:test';
import { allLessonTypes, lessonTypeLabelKey } from './lesson-type-routing';

test('every known lesson type resolves to a label key', () => {
  for (const type of allLessonTypes()) {
    assert.equal(typeof lessonTypeLabelKey(type), 'string');
  }
});

test('label keys are distinct per type (no two lesson types share a label)', () => {
  const keys = allLessonTypes().map((type) => lessonTypeLabelKey(type));
  assert.equal(new Set(keys).size, keys.length);
});

// Regression guard: if a 4th LessonType is ever added to the backend contract, this
// list must be updated in lockstep (course-types.ts + this registry) — this test
// pins the exact set this app currently understands so that drift is caught here
// rather than silently rendering nothing for the new type.
test('the known lesson type set is exactly VIDEO, DOCUMENT, QUIZ', () => {
  assert.deepEqual([...allLessonTypes()].sort(), ['DOCUMENT', 'QUIZ', 'VIDEO']);
});
