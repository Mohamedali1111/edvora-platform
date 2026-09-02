// Pure pagination helpers for the offset-paginated /student/courses list. No React,
// no fetch — kept separate from my-courses-screen.tsx so the bookkeeping (not the
// fetch call itself) can be unit-tested under the plain-Node harness.

export const MY_COURSES_PAGE_SIZE = 25;

export function nextOffset(currentOffset: number, pageSize: number): number {
  return currentOffset + pageSize;
}

/**
 * Appends a freshly-fetched page to the items already shown. Deduplicates by id so
 * a "load more" firing twice for the same offset (e.g. a fast double scroll-to-end)
 * never renders the same course twice — the backend's own `hasMore`/offset paging
 * has no other guard against that here.
 */
export function appendCoursePage<T extends { courseId: string }>(existing: T[], page: T[]): T[] {
  const byId = new Map<string, T>();

  for (const item of [...existing, ...page]) {
    if (!byId.has(item.courseId)) {
      byId.set(item.courseId, item);
    }
  }

  return [...byId.values()];
}
