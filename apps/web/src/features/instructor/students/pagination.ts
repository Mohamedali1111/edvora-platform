/**
 * Pure offset-pagination math shared by the students list, the enrollments
 * section, and the course selector - the frozen backend's contract is only
 * `{ items, limit, offset, hasMore }`, so "next" is driven exclusively by
 * `hasMore` and "previous" exclusively by `offset > 0`. No page count or
 * total is ever derived here.
 */
export function previousOffset(offset: number, pageSize: number): number {
  return Math.max(0, offset - pageSize);
}

export function nextOffset(offset: number, pageSize: number): number {
  return offset + pageSize;
}

export function canGoPrevious(offset: number): boolean {
  return offset > 0;
}

export function canGoNext(hasMore: boolean): boolean {
  return hasMore;
}
