/**
 * Verifies that `submittedIds` is exactly the same set as `currentIds`: no missing entries,
 * no duplicates, and no foreign entries. Used to validate whole-list reorder payloads before
 * any position is written, so a reorder can never adopt a resource that does not already
 * belong to the authorized parent.
 */
export function assertExactChildIdSet(
  currentIds: string[],
  submittedIds: string[],
  createError: () => Error,
): void {
  const currentSet = new Set(currentIds);
  const submittedSet = new Set(submittedIds);

  const hasDuplicates = submittedSet.size !== submittedIds.length;
  const wrongCardinality = submittedSet.size !== currentSet.size;
  const hasForeignOrMissingIds = [...submittedSet].some((id) => !currentSet.has(id));

  if (hasDuplicates || wrongCardinality || hasForeignOrMissingIds) {
    throw createError();
  }
}
