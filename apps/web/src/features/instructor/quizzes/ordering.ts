import type { QuestionSummary, QuizStatus } from "@/lib/api/types";
import { canReorderQuestion } from "./lifecycle";

export function reorderableQuestionIds(quizStatus: QuizStatus, questions: QuestionSummary[]): string[] {
  return questions.filter((question) => canReorderQuestion(quizStatus, question.status)).map((question) => question.questionId);
}

export function moveEarlier(order: readonly string[], id: string): string[] | null {
  const index = order.indexOf(id);

  if (index <= 0) {
    return null;
  }

  const next = [...order];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return next;
}

export function moveLater(order: readonly string[], id: string): string[] | null {
  const index = order.indexOf(id);

  if (index === -1 || index >= order.length - 1) {
    return null;
  }

  const next = [...order];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return next;
}
