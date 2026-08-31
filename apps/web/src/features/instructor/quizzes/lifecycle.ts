import type { QuestionStatus, QuizStatus } from "@/lib/api/types";

export function canEditQuiz(status: QuizStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

export function canPublishQuiz(status: QuizStatus): boolean {
  return status === "DRAFT";
}

export function canArchiveQuiz(status: QuizStatus): boolean {
  return status === "DRAFT" || status === "PUBLISHED";
}

export function isQuizArchived(status: QuizStatus): boolean {
  return status === "ARCHIVED";
}

export function canCreateQuestion(status: QuizStatus): boolean {
  return status === "DRAFT";
}

export function canMutateQuestion(status: QuizStatus, questionStatus: QuestionStatus): boolean {
  return canEditQuiz(status) && questionStatus === "ACTIVE";
}

export function canReorderQuestion(status: QuizStatus, questionStatus: QuestionStatus): boolean {
  return canMutateQuestion(status, questionStatus);
}

export function canMutateOption(status: QuizStatus, questionStatus: QuestionStatus): boolean {
  return canMutateQuestion(status, questionStatus);
}
