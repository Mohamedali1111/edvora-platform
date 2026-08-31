import type { LessonSummary } from "../../../../../lib/api/types";
import { canReorderLesson } from "./lifecycle";

// `moveEarlier`/`moveLater` are pure array-of-ids swap functions with no
// Section-specific typing at all (see sections/ordering.ts) - reused here via
// import rather than duplicated, per the same identical two-phase reorder
// contract Lessons and Sections both use. The already-committed Section
// ordering module is not modified.
export { moveEarlier, moveLater } from "../ordering";

/**
 * The reorderable subset, in current order - archived lessons are excluded
 * (see lifecycle.ts's canReorderLesson) and never appear in a reorder
 * request; they keep their own retained position untouched regardless of
 * where they sit in the full list.
 */
export function reorderableLessonIds(lessons: LessonSummary[]): string[] {
  return lessons.filter((lesson) => canReorderLesson(lesson.status)).map((lesson) => lesson.lessonId);
}
