import assert from 'node:assert/strict';
import test from 'node:test';
import { appendCoursePage, nextOffset, MY_COURSES_PAGE_SIZE } from './pagination';

test('nextOffset advances by the page size', () => {
  assert.equal(nextOffset(0, MY_COURSES_PAGE_SIZE), MY_COURSES_PAGE_SIZE);
  assert.equal(nextOffset(25, 25), 50);
  assert.equal(nextOffset(50, 10), 60);
});

test('appendCoursePage concatenates a fresh page onto existing items', () => {
  const existing = [{ courseId: 'a' }, { courseId: 'b' }];
  const page = [{ courseId: 'c' }, { courseId: 'd' }];

  assert.deepEqual(appendCoursePage(existing, page), [
    { courseId: 'a' },
    { courseId: 'b' },
    { courseId: 'c' },
    { courseId: 'd' },
  ]);
});

test('appendCoursePage deduplicates by courseId (a repeated "load more" must not duplicate rows)', () => {
  const existing = [{ courseId: 'a' }, { courseId: 'b' }];
  const page = [{ courseId: 'b' }, { courseId: 'c' }];

  assert.deepEqual(appendCoursePage(existing, page), [{ courseId: 'a' }, { courseId: 'b' }, { courseId: 'c' }]);
});

test('appendCoursePage on an empty existing list is just the page, deduplicated', () => {
  assert.deepEqual(appendCoursePage([], [{ courseId: 'a' }, { courseId: 'a' }]), [{ courseId: 'a' }]);
});
