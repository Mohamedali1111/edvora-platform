/**
 * The one standard shape for every bounded offset-paginated list response in this API. Additive
 * over the pre-existing `{ items, limit, offset }` contract — `hasMore` is the only new field, no
 * existing field is renamed or removed, and no route/filter/pagination-default semantics change.
 * `total` is deliberately not included; that is reserved for a future slice.
 */
export type OffsetPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

/**
 * Turns a `take: limit + 1`-fetched row set into the real page plus a correct `hasMore`, without
 * a second `COUNT(*)` query. Every list service in this API calls this immediately after its
 * `findMany`/equivalent (`take: input.limit + 1`) and BEFORE building any list of IDs from the
 * page for a follow-up query (e.g. an aggregate `groupBy` keyed on the page's row IDs) — the
 * sentinel (limit + 1)th row, when present, must never leak into `items`, never participate in a
 * page-scoped aggregate, and never affect a returned count.
 *
 * Deliberately not `rows.length === limit` as the `hasMore` test: that incorrectly reports a next
 * page when the result set ends exactly on a page boundary (e.g. exactly 25 rows total with
 * `limit=25`) — the classic off-by-one this `take: limit + 1` / slice pattern avoids entirely.
 */
export function trimToOffsetPage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
