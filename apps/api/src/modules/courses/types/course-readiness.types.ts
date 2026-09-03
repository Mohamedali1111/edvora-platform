import type { LessonType } from '../../../../.generated/prisma/client';
import type { QuizPublishabilityReasonCode } from '../../quizzes/services/quiz-publishability.util';

/**
 * The Course/Section/Lesson/Quiz/VideoAsset/DocumentAsset entity kinds a `ReadinessIssue` can point
 * at. Matches the approved Course Readiness contract exactly.
 */
export type ReadinessEntityType = 'SECTION' | 'LESSON' | 'QUIZ' | 'VIDEO_ASSET' | 'DOCUMENT_ASSET';

/**
 * Stable, machine-readable readiness reason codes. Never translated/localized copy — the Instructor
 * Web maps a code to localized text; see `docs/BACKEND-DOMAIN.md` ("Course Readiness Derivation").
 *
 * Deliberately NOT included: a "Section/Lesson is DRAFT" code. DRAFT is the expected, normal
 * lifecycle state of a first-publish candidate — the whole point of `readyToPublish` is to surface
 * exactly the DRAFT Sections/Lessons a future publish-selected call would transition to PUBLISHED —
 * so surfacing DRAFT itself as a blocker would misrepresent completely normal progressive authoring
 * as a problem. See `evaluateCourseReadiness`'s doc comment for the full candidacy rule.
 */
export type CourseReadinessReasonCode =
  | 'SECTION_EMPTY'
  | 'LESSON_AVAILABILITY_WINDOW_ELAPSED'
  | 'VIDEO_PREPARING'
  | 'VIDEO_FAILED'
  | 'VIDEO_ASSET_ARCHIVED'
  | 'DOCUMENT_PREPARING'
  | 'DOCUMENT_FAILED'
  | 'DOCUMENT_ASSET_ARCHIVED'
  | 'QUIZ_ARCHIVED'
  | QuizPublishabilityReasonCode;

/**
 * One readiness fact about one entity. `title` is the entity's own raw authored title where one
 * exists (Section/Lesson/Quiz titles are user content, not UI copy) — for VIDEO_ASSET/DOCUMENT_ASSET
 * issues, which have no such field of their own, `title` carries the owning Lesson's title instead,
 * matching the previous client-side readiness model's use of `lessonTitle` for content blockers.
 * `detail`, where present, is a raw internal/technical string (a stored failure code/reason, or an
 * ISO timestamp) — never a translated, human-facing message.
 */
export type ReadinessIssue = {
  reasonCode: CourseReadinessReasonCode;
  entityType: ReadinessEntityType;
  entityId: string;
  parentSectionId?: string;
  parentLessonId?: string;
  title?: string;
  detail?: string;
};

export type ReadyToPublishSection = {
  sectionId: string;
  title: string;
};

export type ReadyToPublishLesson = {
  lessonId: string;
  sectionId: string;
  title: string;
  type: LessonType;
};

/**
 * Informational only — metadata for a still-DRAFT Quiz backing a candidate QUIZ Lesson, i.e. a Quiz
 * the future publish-selected endpoint will need to transition to PUBLISHED as a server-side side
 * effect of publishing its Lesson. An already-PUBLISHED Quiz backing a candidate Lesson does NOT
 * appear here — it needs no transition, so there is nothing for publish-selected to do to it. The
 * future publish-selected endpoint must never trust a client-supplied quizId; it will re-resolve
 * every Quiz from the Course's own Lesson relations server-side, exactly as this endpoint does.
 */
export type ReadyToPublishQuiz = {
  quizId: string;
  lessonId: string;
  title: string;
};

/**
 * The set of Sections/Lessons/Quizzes currently eligible to be explicitly selected for this
 * Course's (first or a later) publish review — see `evaluateCourseReadiness`'s doc comment for the
 * exact per-entity eligibility rule.
 */
export type ReadyToPublish = {
  sections: ReadyToPublishSection[];
  lessons: ReadyToPublishLesson[];
  quizzes: ReadyToPublishQuiz[];
};

export type CourseReadiness = {
  courseId: string;
  ready: boolean;
  computedAt: Date;
  blockers: ReadinessIssue[];
  advisories: ReadinessIssue[];
  readyToPublish: ReadyToPublish;
};
