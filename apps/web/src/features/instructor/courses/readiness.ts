import type { AssetProcessingStatus, LessonStatus, LessonSummary, LessonType, QuizStatus, SectionStatus } from "@/lib/api/types";

/**
 * Compact, deterministic "what will students see if I publish this?"
 * summary derived entirely from data the Course Detail page already loads
 * or can load through existing, already-used list endpoints (Sections,
 * Lessons, Media, Quizzes) - no new backend aggregate endpoint, per the
 * product requirement to make the backend's existing multi-level
 * publication rules (Course/Section/Lesson/Quiz) understandable without
 * exposing their implementation as jargon. Pure and framework-free (no
 * i18n dependency) so it is fully unit-testable; the Course Detail UI is
 * responsible for turning a `ReadinessBlocker` into localized copy.
 */
export type ContentReadiness = "READY" | "NOT_READY" | "UNKNOWN";

export type ReadinessLessonInput = {
  lessonId: string;
  title: string;
  status: LessonStatus;
  type: LessonType;
  contentReadiness: ContentReadiness;
};

export type ReadinessSectionInput = {
  sectionId: string;
  title: string;
  status: SectionStatus;
  lessons: ReadinessLessonInput[];
};

export type CourseReadinessInput = {
  sections: ReadinessSectionInput[];
};

export type ReadinessBlocker =
  | { kind: "draftSection"; sectionTitle: string }
  | { kind: "draftLesson"; lessonTitle: string }
  | { kind: "contentNotReady"; lessonTitle: string; contentType: LessonType }
  | { kind: "contentUnknown"; lessonTitle: string; contentType: LessonType };

export type CourseReadiness = {
  ready: boolean;
  blockers: ReadinessBlocker[];
};

/**
 * ARCHIVED sections/lessons are never shown to students and are excluded
 * from readiness entirely - they're neither a blocker nor evidence of
 * readiness. A DRAFT section is reported once, without also walking its
 * lessons: an unpublished section hides all its lessons from students
 * regardless of their own status, so per-lesson blockers underneath it
 * would just be noisy duplicates of the one actionable item (publish the
 * section). Order matches how an instructor would naturally act: fix
 * section visibility first, then lesson visibility, then lesson content.
 */
export function deriveCourseReadiness(input: CourseReadinessInput): CourseReadiness {
  const blockers: ReadinessBlocker[] = [];

  for (const section of input.sections) {
    if (section.status === "ARCHIVED") {
      continue;
    }

    if (section.status === "DRAFT") {
      blockers.push({ kind: "draftSection", sectionTitle: section.title });
      continue;
    }

    for (const lesson of section.lessons) {
      if (lesson.status === "ARCHIVED") {
        continue;
      }

      if (lesson.status === "DRAFT") {
        blockers.push({ kind: "draftLesson", lessonTitle: lesson.title });
        continue;
      }

      if (lesson.contentReadiness === "NOT_READY") {
        blockers.push({ kind: "contentNotReady", lessonTitle: lesson.title, contentType: lesson.type });
      } else if (lesson.contentReadiness === "UNKNOWN") {
        blockers.push({ kind: "contentUnknown", lessonTitle: lesson.title, contentType: lesson.type });
      }
    }
  }

  return { ready: blockers.length === 0, blockers };
}

/**
 * Resolves one Lesson's underlying content readiness from already-fetched
 * asset/Quiz status lookups (see readiness-data.ts). "UNKNOWN" - never
 * silently treated as ready - covers the one honest gap in this
 * bounded-fetch approach: a referenced asset/Quiz that didn't come back in
 * the (page-limited) Media/Quiz lookups this feature already fetches
 * elsewhere. It is surfaced as its own distinct, transparent blocker
 * ("couldn't verify") rather than guessed either way.
 */
export function resolveContentReadiness(
  lesson: Pick<LessonSummary, "type" | "videoAssetId" | "documentAssetId" | "quizId">,
  lookups: {
    videoStatus: ReadonlyMap<string, AssetProcessingStatus>;
    documentStatus: ReadonlyMap<string, AssetProcessingStatus>;
    quizStatus: ReadonlyMap<string, QuizStatus>;
  },
): ContentReadiness {
  if (lesson.type === "VIDEO") {
    const status = lesson.videoAssetId ? lookups.videoStatus.get(lesson.videoAssetId) : undefined;
    return status === undefined ? "UNKNOWN" : status === "READY" ? "READY" : "NOT_READY";
  }

  if (lesson.type === "DOCUMENT") {
    const status = lesson.documentAssetId ? lookups.documentStatus.get(lesson.documentAssetId) : undefined;
    return status === undefined ? "UNKNOWN" : status === "READY" ? "READY" : "NOT_READY";
  }

  const status = lesson.quizId ? lookups.quizStatus.get(lesson.quizId) : undefined;
  return status === undefined ? "UNKNOWN" : status === "PUBLISHED" ? "READY" : "NOT_READY";
}
