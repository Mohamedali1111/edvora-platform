import {
  QuestionStatus,
  QuestionType,
  QuizStatus,
  type Prisma,
} from '../../../../.generated/prisma/client';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import { InvalidQuizLifecycleTransitionError, QuizNotFoundError, QuizNotPublishableError } from '../errors/quiz.errors';

export type QuizPublishabilityRow = {
  status: QuizStatus;
  passingScorePercent: { toNumber(): number } | null;
  attemptLimit: number | null;
  questions: Array<{
    type: QuestionType;
    points: { toNumber(): number };
    options: Array<{ isCorrect: boolean }>;
  }>;
};

export function assertQuizPublishable(quiz: QuizPublishabilityRow): void {
  if (quiz.attemptLimit !== null && quiz.attemptLimit < 1) {
    throw new QuizNotPublishableError();
  }

  if (quiz.passingScorePercent !== null) {
    const threshold = quiz.passingScorePercent.toNumber();
    if (threshold < 0 || threshold > 100) {
      throw new QuizNotPublishableError();
    }
  }

  if (quiz.questions.length === 0) {
    throw new QuizNotPublishableError();
  }

  let totalPoints = 0;

  for (const question of quiz.questions) {
    const points = question.points.toNumber();
    if (points <= 0) {
      throw new QuizNotPublishableError();
    }

    totalPoints += points;

    const correctCount = question.options.filter((option) => option.isCorrect).length;
    if (correctCount !== 1) {
      throw new QuizNotPublishableError();
    }

    if (question.type === QuestionType.TRUE_FALSE && question.options.length !== 2) {
      throw new QuizNotPublishableError();
    }

    if (question.type === QuestionType.MULTIPLE_CHOICE && question.options.length < 2) {
      throw new QuizNotPublishableError();
    }
  }

  if (totalPoints <= 0) {
    throw new QuizNotPublishableError();
  }
}

export async function assertPublishedQuizRemainsPublishable(
  tx: PrismaTransactionClient,
  tenantId: string,
  quizId: string,
): Promise<void> {
  const quiz = await tx.quiz.findUniqueOrThrow({
    where: { id_tenantId: { id: quizId, tenantId } },
    select: quizPublishabilitySelect,
  });

  if (quiz.status === QuizStatus.PUBLISHED) {
    assertQuizPublishable(quiz);
  }
}

export async function lockAndAssertQuizAuthoringMutable(
  tx: PrismaTransactionClient,
  tenantId: string,
  quizId: string,
): Promise<{ status: QuizStatus }> {
  await lockQuizPublicationBoundary(tx, quizId);

  const quiz = await tx.quiz.findUnique({
    where: { id_tenantId: { id: quizId, tenantId } },
    select: { status: true },
  });

  if (!quiz) {
    throw new QuizNotFoundError();
  }

  if (quiz.status === QuizStatus.ARCHIVED) {
    throw new InvalidQuizLifecycleTransitionError();
  }

  return quiz;
}

/**
 * Serializes every operation that can move a Quiz across the DRAFT/PUBLISHED "publication
 * boundary" or mutate the aggregate a PUBLISHED Quiz must keep satisfying, using the same
 * transaction-scoped PostgreSQL advisory-lock pattern already established by
 * `QuestionOptionService.lockQuestionOptionMutations` (itself modeled on
 * `StudentDeviceService.lockStudentDeviceState`) — no schema change, no new infrastructure.
 *
 * Why this is required, not optional: under PostgreSQL READ COMMITTED, a plain `SELECT` of
 * `Quiz.status` never blocks on a concurrent transaction's uncommitted `UPDATE` of that same
 * row — it just returns the last *committed* value. So without this lock, two concurrent
 * transactions can race past each other undetected:
 *   1. Transaction A (`publishQuiz`) reads/validates the aggregate and is about to flip
 *      DRAFT -> PUBLISHED.
 *   2. Transaction B (e.g. `createOption`/`updateOption` with a mutation that would make the
 *      aggregate invalid) reads `Quiz.status` as still DRAFT — A hasn't committed yet — so
 *      `assertPublishedQuizRemainsPublishable`'s "only enforce when PUBLISHED" guard is a no-op.
 *   3. A commits DRAFT -> PUBLISHED.
 *   4. B commits its now-aggregate-invalid mutation.
 *   Final state: PUBLISHED + aggregate-invalid — exactly the state this whole invariant exists
 *   to prevent, and a post-mutation status check alone cannot catch it.
 *
 * `pg_advisory_xact_lock` closes this: every caller below acquires this same `quizId`-scoped
 * lock as its very first step, before any read of the Quiz row. Whichever transaction acquires
 * it first runs to completion (commit or rollback) before the second is allowed to proceed, so
 * by the time the second transaction's own status/aggregate read executes, it observes the
 * first transaction's already-committed result — never a stale in-flight value. This turns the
 * race into a deterministic ordering: either the mutation is serialized before publish (publish
 * then freshly re-validates and rejects if the mutation left the aggregate invalid) or after
 * publish (the mutation's own `assertPublishedQuizRemainsPublishable` call now correctly
 * observes PUBLISHED and enforces the aggregate). "PUBLISHED + aggregate-invalid" cannot result
 * from either ordering.
 *
 * Callers, and why each does or does not need this lock:
 *  - `QuizService.publishQuiz` — acquires it (moves the boundary itself).
 *  - `QuestionService.createQuestion` / `updateQuestionMetadata` — acquire it (can affect the
 *    aggregate: a new question, or a changed points value).
 *  - `QuestionOptionService.createOption` / `updateOption` — acquire it, in addition to their
 *    existing `questionId`-scoped lock (can affect the aggregate: option count/correctness).
 *  - `QuestionService.reorderQuestions`, `QuestionOptionService.reorderOptions` — acquire it
 *    through `lockAndAssertQuizAuthoringMutable` so they serialize against archive and cannot
 *    mutate an already-ARCHIVED parent; they still do not need publishability validation because
 *    reordering only ever changes `position`.
 *  - `QuizService.archiveQuiz` — acquires it so archive serializes against every ordinary
 *    Question/Option authoring mutation. A mutation may commit before archive, but no mutation can
 *    observe a non-archived parent and then commit after archive has already made the Quiz ARCHIVED.
 *
 *  - `QuizService.unpublishQuiz` - acquires it because PUBLISHED -> DRAFT crosses the same
 *    publication boundary and must serialize with publishability-affecting mutations.
 *  - `QuizService.restoreQuiz` - acquires it because ARCHIVED -> DRAFT crosses the same
 *    publication boundary and must serialize with publishability-affecting mutations.
 *
 * Lock ordering: every path that needs both locks acquires this Quiz-level lock strictly
 * *before* the Question-level lock (`createOption`/`updateOption`: Quiz lock, then
 * `lockQuestionOptionMutations`). No path ever acquires the Question-level lock first and this
 * one second. Keeping that ordering single-directional across every caller is what rules out an
 * A-locks-quiz-then-question / B-locks-question-then-quiz deadlock — do not reverse it when
 * adding new callers. A distinct hash namespace (`1` here vs `0` for the Question-level lock)
 * keeps the two lock domains visually and numerically distinct, though a `questionId` and a
 * `quizId` are both UUIDs from disjoint ID spaces and would not practically collide either way.
 */
export async function lockQuizPublicationBoundary(tx: PrismaTransactionClient, quizId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${quizId}, 1::bigint))`;
}

export const quizPublishabilitySelect = {
  status: true,
  passingScorePercent: true,
  attemptLimit: true,
  questions: {
    where: { status: QuestionStatus.ACTIVE },
    select: {
      id: true,
      type: true,
      points: true,
      options: { select: { id: true, isCorrect: true } },
    },
  },
} satisfies Prisma.QuizSelect;
