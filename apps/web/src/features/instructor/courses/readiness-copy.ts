import type { TranslationKey } from "../../../lib/i18n/translations";
import type { CourseReadinessReasonCode, ReadinessIssue } from "../../../lib/api/types";

/**
 * Translates the server's stable, machine-readable `CourseReadinessReasonCode`
 * (docs/DECISIONS.md DEC-0049) into a translated, instructor-facing message
 * key - the one place this mapping is defined, shared by the Readiness Strip,
 * the Lesson row content-status badge, the First-Publish Review, and stale
 * (PUBLISH_SELECTION_STALE) re-review. None of these ever show a raw reason
 * code, `detail` string, or provider/processing jargon - only this table's
 * translated copy, filled in with the issue's own real `title` where the
 * key expects one (`{title}`).
 */
const REASON_CODE_KEY: Record<CourseReadinessReasonCode, TranslationKey> = {
  SECTION_EMPTY: "courses.readinessChapterEmpty",
  LESSON_AVAILABILITY_WINDOW_ELAPSED: "courses.readinessAvailabilityElapsed",
  VIDEO_PREPARING: "courses.readinessVideoProcessing",
  VIDEO_FAILED: "courses.readinessVideoFailed",
  VIDEO_ASSET_ARCHIVED: "courses.readinessVideoArchived",
  DOCUMENT_PREPARING: "courses.readinessDocumentProcessing",
  DOCUMENT_FAILED: "courses.readinessDocumentFailed",
  DOCUMENT_ASSET_ARCHIVED: "courses.readinessDocumentArchived",
  QUIZ_ARCHIVED: "courses.readinessQuizArchived",
  QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS: "courses.readinessQuizNoQuestions",
  QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION: "courses.readinessQuizMissingCorrectOption",
  QUIZ_NOT_PUBLISHABLE_INVALID_POINTS: "courses.readinessQuizInvalidPoints",
  SECTION_NOT_SELECTABLE: "courses.readinessChapterNotSelectable",
  LESSON_NOT_SELECTABLE: "courses.readinessLessonNotSelectable",
  LESSON_SECTION_NOT_INCLUDED: "courses.readinessLessonChapterNotIncluded",
};

/** The translation key for one readiness issue's reason code - the raw code itself is never shown. */
export function readinessReasonKey(reasonCode: CourseReadinessReasonCode): TranslationKey {
  return REASON_CODE_KEY[reasonCode];
}

/** One fully-composed, translated message for a readiness issue - `{title}` filled with the issue's own real entity title, never a placeholder. */
export function readinessIssueMessage(issue: ReadinessIssue, t: (key: TranslationKey) => string): string {
  return t(readinessReasonKey(issue.reasonCode)).replace("{title}", issue.title ?? "");
}

/**
 * A Lesson row's content-readiness category, derived from the subset of
 * blockers that belong to it (matched by `parentLessonId`). Never "ready"
 * by the presence of a blocker - a Lesson with zero content blockers has
 * nothing to show here at all (see lesson row usage: only rendered when
 * this returns something other than the lesson's own ordinary lifecycle
 * status badge already communicates). `"processing"` only wins over
 * `"needsAttention"` when nothing worse is present - a failed/archived/
 * unpublishable issue is always the more actionable, more severe fact to
 * surface first.
 */
export type LessonContentReadiness = "processing" | "needsAttention" | "failed";

const NEEDS_ATTENTION_CODES: ReadonlySet<CourseReadinessReasonCode> = new Set<CourseReadinessReasonCode>([
  "VIDEO_ASSET_ARCHIVED",
  "DOCUMENT_ASSET_ARCHIVED",
  "QUIZ_ARCHIVED",
  "QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS",
  "QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION",
  "QUIZ_NOT_PUBLISHABLE_INVALID_POINTS",
]);

const FAILED_CODES: ReadonlySet<CourseReadinessReasonCode> = new Set<CourseReadinessReasonCode>(["VIDEO_FAILED", "DOCUMENT_FAILED"]);

const PROCESSING_CODES: ReadonlySet<CourseReadinessReasonCode> = new Set<CourseReadinessReasonCode>(["VIDEO_PREPARING", "DOCUMENT_PREPARING"]);

/**
 * Picks the single most severe/actionable category out of one Lesson's
 * content blockers, or `null` when it has none (a Lesson with no content
 * blockers needs no extra badge beyond its ordinary lifecycle status).
 * Precedence: failed > needs attention > processing - a broken asset is a
 * more urgent fact than one that's merely still preparing, regardless of
 * which the readiness endpoint happened to list first.
 */
export function lessonContentReadiness(lessonBlockers: readonly ReadinessIssue[]): LessonContentReadiness | null {
  const codes = new Set(lessonBlockers.map((issue) => issue.reasonCode));

  if ([...codes].some((code) => FAILED_CODES.has(code))) {
    return "failed";
  }

  if ([...codes].some((code) => NEEDS_ATTENTION_CODES.has(code))) {
    return "needsAttention";
  }

  if ([...codes].some((code) => PROCESSING_CODES.has(code))) {
    return "processing";
  }

  return null;
}

/** Groups a flat blocker/advisory list by the Lesson they belong to (`parentLessonId`) - VIDEO_ASSET/DOCUMENT_ASSET/QUIZ issues all carry this. */
export function groupIssuesByLessonId(issues: readonly ReadinessIssue[]): Map<string, ReadinessIssue[]> {
  const byLesson = new Map<string, ReadinessIssue[]>();

  for (const issue of issues) {
    if (!issue.parentLessonId) {
      continue;
    }

    const existing = byLesson.get(issue.parentLessonId);
    if (existing) {
      existing.push(issue);
    } else {
      byLesson.set(issue.parentLessonId, [issue]);
    }
  }

  return byLesson;
}
