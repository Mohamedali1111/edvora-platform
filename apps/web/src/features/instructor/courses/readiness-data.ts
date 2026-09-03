"use client";

import { useEffect, useState } from "react";
import { getAuthService } from "@/lib/api/session";
import { listVideos, listDocuments } from "@/features/instructor/media/media-service";
import { getQuiz } from "@/features/instructor/quizzes/quizzes-service";
import type { QuizStatus } from "@/lib/api/types";
import { listSections } from "./sections/sections-service";
import { listLessons } from "./sections/lessons/lessons-service";
import { deriveCourseReadiness, resolveContentReadiness, type CourseReadiness, type CourseReadinessInput } from "./readiness";

export type CourseReadinessLoadState =
  | { status: "loading" }
  | { status: "ready"; data: CourseReadiness }
  | { status: "error"; error: unknown };

/**
 * Assembles `CourseReadinessInput` from the same, already-existing
 * tenant-scoped list endpoints Sections/Lessons/Media/Quizzes already use
 * elsewhere in this feature (no new backend aggregate), then derives the
 * compact readiness summary. Sections and each section's Lessons are both
 * unpaginated by the frozen backend contract (every row in one response),
 * so those two are always complete. Video/Document status is looked up
 * against one bounded page of each list (`MEDIA_PAGE_SIZE`, same as Media
 * Management's own default view) - deliberately not an unbounded fetch
 * loop; an asset outside that page resolves honestly to "UNKNOWN" (see
 * `resolveContentReadiness`) rather than being assumed ready. Quiz status
 * is looked up precisely, one `getQuiz` call per distinct Quiz a Lesson in
 * this course actually references (typically small), so it has no such
 * bound. This hook fetches on mount, on `retry()` (a manual Refresh
 * action), and whenever the caller's own `contentVersion` changes -
 * `course-detail.tsx` bumps that after any in-page Section/Lesson create or
 * lifecycle (publish/archive) mutation, so readiness tracks the one class
 * of change most likely to make it stale while the instructor is actually
 * looking at it (see `CourseDetailBody`'s `bumpContentVersion`). It does
 * NOT poll and does NOT know about Quiz/Media edits made on their own
 * separate routes - those are covered by the same manual Refresh action,
 * honestly labeled in the UI (`readiness-panel.tsx`), and by the fact that
 * navigating back to this Course Detail route from elsewhere remounts this
 * hook and refetches automatically (a distinct route, not a kept-alive
 * tab) - see docs on that in `course-detail.tsx`.
 */
export function useCourseReadiness(
  tenantId: string,
  courseId: string,
  contentVersion: number,
): { state: CourseReadinessLoadState; retry: () => void } {
  const [state, setState] = useState<CourseReadinessLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const key = `${tenantId}:${courseId}:${contentVersion}:${attempt}`;
  const [trackedKey, setTrackedKey] = useState(key);

  if (trackedKey !== key) {
    setTrackedKey(key);
    setState({ status: "loading" });
  }

  useEffect(() => {
    let cancelled = false;
    const client = getAuthService().getClient();

    async function load(): Promise<CourseReadiness> {
      const sectionsResponse = await listSections(client, tenantId, courseId);
      const sections = sectionsResponse.items;

      const lessonsPerSection = await Promise.all(sections.map((section) => listLessons(client, tenantId, courseId, section.sectionId)));

      const [videosPage, documentsPage] = await Promise.all([listVideos(client, tenantId, 0), listDocuments(client, tenantId, 0)]);

      const videoStatus = new Map(videosPage.items.map((video) => [video.videoAssetId, video.processingStatus] as const));
      const documentStatus = new Map(documentsPage.items.map((document_) => [document_.documentAssetId, document_.processingStatus] as const));

      const referencedQuizIds = new Set<string>();
      for (const response of lessonsPerSection) {
        for (const lesson of response.items) {
          if (lesson.type === "QUIZ" && lesson.quizId) {
            referencedQuizIds.add(lesson.quizId);
          }
        }
      }

      const quizEntries = await Promise.all(
        Array.from(referencedQuizIds).map(async (quizId): Promise<readonly [string, QuizStatus] | null> => {
          try {
            const quiz = await getQuiz(client, tenantId, quizId);
            return [quizId, quiz.status] as const;
          } catch {
            // A referenced Quiz that can no longer be fetched resolves to
            // "UNKNOWN" via the missing map entry below, not a thrown
            // error - one broken reference must not fail the whole
            // readiness check.
            return null;
          }
        }),
      );
      const quizStatus = new Map(quizEntries.filter((entry): entry is readonly [string, QuizStatus] => entry !== null));

      const readinessInput: CourseReadinessInput = {
        sections: sections.map((section, index) => ({
          sectionId: section.sectionId,
          title: section.title,
          status: section.status,
          lessons: lessonsPerSection[index].items.map((lesson) => ({
            lessonId: lesson.lessonId,
            title: lesson.title,
            status: lesson.status,
            type: lesson.type,
            contentReadiness: resolveContentReadiness(lesson, { videoStatus, documentStatus, quizStatus }),
          })),
        })),
      };

      return deriveCourseReadiness(readinessInput);
    }

    load()
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, courseId, contentVersion, attempt]);

  return { state, retry: () => setAttempt((value) => value + 1) };
}
