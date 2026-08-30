import type { QuestionType } from '../../../../.generated/prisma/client';

/**
 * Student-facing quiz-delivery response shapes. Deliberately a completely separate family from
 * the instructor-authoring `QuizSummary`/`QuestionSummary`/`QuestionOptionSummary` types in
 * `quiz.types.ts`, which are never reused here — in particular
 * `QuestionOptionSummary.isCorrect` (correct-answer configuration) must never reach a student
 * before they attempt the quiz. Every field below has been reviewed to be pre-attempt safe: no
 * `isCorrect`, no answer key, no scoring internals (`points`, `passingScorePercent`,
 * `attemptLimit`, `revealAnswersPolicy`), and no instructor/tenant-ownership metadata. Question
 * and option IDs are included because a future answer-submission slice will need stable
 * references to them; nothing else authoring-only is exposed.
 */

export type StudentQuestionOption = {
  optionId: string;
  label: string | null;
  text: string;
  position: number;
};

export type StudentQuestion = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  options: StudentQuestionOption[];
};

export type StudentQuizContent = {
  quizId: string;
  title: string;
  description: string | null;
  questions: StudentQuestion[];
};
