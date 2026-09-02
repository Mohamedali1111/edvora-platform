import type { StudentQuizAttemptQuestion } from './quiz-types';

// Pure, RN-free helpers for the runtime-only `questionId -> selectedOptionId`
// state the Quiz screen keeps (see quiz-lesson-screen.tsx). Never computes or
// stores correctness — only which option is currently selected, exactly the
// backend's own `selectedOptionId` shape (one option per question; V1 has no
// multi-select question type — see quiz-types.ts).

export type QuizAnswers = Record<string, string | null>;

/**
 * Rebuilds the local answers map from an authoritative `StudentQuizAttemptDetail`
 * response — the screen calls this after every start/save/submit so local state
 * can never drift from the server's own record of what was actually saved.
 */
export function answersFromAttemptQuestions(questions: StudentQuizAttemptQuestion[]): QuizAnswers {
  const answers: QuizAnswers = {};

  for (const question of questions) {
    answers[question.questionId] = question.selectedOptionId;
  }

  return answers;
}

/** How many questions have no saved selection yet — shown as an honest info note, never a submit block (the backend does not require every question answered). */
export function countUnanswered(questions: StudentQuizAttemptQuestion[], answers: QuizAnswers): number {
  return questions.filter((question) => !answers[question.questionId]).length;
}

export function isQuizAttemptGraded(status: string): boolean {
  return status === 'GRADED';
}
