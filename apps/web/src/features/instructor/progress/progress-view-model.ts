import type { CourseProgressRow } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";

export type ProgressEmptyContext = "noCourse" | "noQuiz" | "courseRows" | "courseRowsFiltered" | "quizAttempts" | "quizAttemptsFiltered";

export type ProgressRowSignal = {
  id: "no-lessons" | "complete" | "no-activity" | "in-progress";
  labelKey: TranslationKey;
};

export function resolveProgressEmptyMessage(context: ProgressEmptyContext): TranslationKey {
  switch (context) {
    case "noCourse":
      return "progress.noCourseSelected";
    case "noQuiz":
      return "progress.noQuizSelected";
    case "courseRowsFiltered":
      return "progress.emptyFiltered";
    case "quizAttemptsFiltered":
      return "progress.resultsEmptyFiltered";
    case "quizAttempts":
      return "progress.resultsEmpty";
    case "courseRows":
      return "progress.empty";
  }
}

export function resolveCourseProgressSignal(row: CourseProgressRow): ProgressRowSignal {
  if (row.totalLessons === 0) {
    return { id: "no-lessons", labelKey: "progress.noLessons" };
  }

  if (row.progressPercent >= 100) {
    return { id: "complete", labelKey: "progress.signalComplete" };
  }

  if (row.lastActivityAt === null) {
    return { id: "no-activity", labelKey: "progress.activityNone" };
  }

  return { id: "in-progress", labelKey: "progress.signalInProgress" };
}
