import { Injectable } from '@nestjs/common';
import {
  Prisma,
  QuestionStatus,
  QuestionType,
  QuizAttemptStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import {
  QuestionNotFoundError,
  QuestionOptionNotFoundError,
  QuizAttemptLimitReachedError,
  QuizAttemptNotFoundError,
  QuizAttemptNotOpenError,
  QuizHasNoActiveQuestionsError,
} from '../errors/quiz.errors';
import type {
  StudentQuizAttemptDetail,
  StudentQuizAttemptQuestion,
  StudentQuizAttemptResult,
} from '../types/student-quiz-attempt.types';

/**
 * The immutable per-question snapshot shape frozen into `QuizAttemptAnswer.questionSnapshot` at
 * attempt start. Server-authored only — never accepted from a client, never re-derived from live
 * `Question` rows after start.
 */
type QuestionSnapshotJson = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  position: number;
};

/** The immutable per-option snapshot shape frozen into `QuizAttemptAnswer.optionsSnapshot`. */
type OptionSnapshotJson = {
  optionId: string;
  label: string | null;
  text: string;
  position: number;
};

/**
 * The immutable, backend-only answer-key snapshot frozen into
 * `QuizAttemptAnswer.correctAnswerSnapshot` at attempt start (DEC-0025: "Correct-answer
 * snapshots are backend-only and must not be exposed before the reveal policy allows it"). Only
 * ever read by the scoring-only query in `submitAttempt` — never selected by any query whose
 * result feeds a student-facing response.
 */
type CorrectAnswerSnapshotJson = {
  correctOptionIds: string[];
};

// Fetched by every read/write path that returns a student-facing response. Deliberately never
// selects `correctAnswerSnapshot` or `pointsAwarded`/`pointsPossible` — defense in depth so a
// mapping bug cannot leak answer-key or per-question scoring data even in principle, since those
// fields are never even loaded into memory on this path.
const ATTEMPT_ANSWER_SAFE_SELECT = {
  id: true,
  questionId: true,
  questionSnapshot: true,
  optionsSnapshot: true,
  selectedOptionIdsSnapshot: true,
} as const;

const ATTEMPT_DETAIL_SELECT = {
  id: true,
  quizId: true,
  status: true,
  attemptNumber: true,
  startedAt: true,
  submittedAt: true,
  gradedAt: true,
  scorePoints: true,
  maxPoints: true,
  passed: true,
  answers: { select: ATTEMPT_ANSWER_SAFE_SELECT },
} as const;

type AttemptDetailRow = Prisma.QuizAttemptGetPayload<{ select: typeof ATTEMPT_DETAIL_SELECT }>;

@Injectable()
export class StudentQuizAttemptService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: StudentCourseAccessService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  /**
   * Re-checks live Quiz Lesson authorization at request time (never reuses a stale proof), then
   * atomically creates the Attempt and its full per-question snapshot from trusted, DB-fresh
   * authoring state. Only currently `ACTIVE` Questions (with their current options) enter the
   * snapshot; `ARCHIVED` Questions can never enter a new attempt. A Quiz with zero `ACTIVE`
   * Questions cannot be started at all (`QuizHasNoActiveQuestionsError`) — the conservative
   * choice, since no product/domain doc defines behavior for an empty quiz and a `maxPoints`-zero
   * attempt has no sensible score.
   *
   * `attemptNumber` assignment is serialized by a transaction-scoped PostgreSQL advisory lock
   * keyed to `(studentUserId, quizId)`, so two concurrent start requests cannot compute the same
   * next `attemptNumber` and collide on the `(quizId, studentUserId, attemptNumber)` unique
   * constraint. The same lock also serializes `attemptLimit` enforcement (see below), so two
   * concurrent start requests when exactly one slot remains cannot both succeed.
   *
   * `attemptLimit` (V1 product rule): the maximum number of attempts successfully started by this
   * student for this Quiz **within the current Enrollment** — scoped by
   * `(studentUserId, enrollmentId, quizId)`, counting every attempt regardless of status
   * (`IN_PROGRESS`, `GRADED`, or a future `ABANDONED`) so abandoning an attempt can never restore
   * allowance. `null` means unlimited, matching the schema's own nullability
   * (`docs/DATABASE-DESIGN.md`: "attemptLimit nullable") — no other "unlimited" sentinel is
   * invented. Re-attempting under a *different* Enrollment (e.g. after re-enrollment) starts a
   * fresh allowance, by design; `attemptNumber` itself remains scoped to `(quizId, studentUserId)`
   * only, per the schema's own unique constraint, and is unaffected by this per-enrollment count.
   *
   * `Quiz.passingScorePercent` is also read here, once, and frozen into
   * `QuizAttempt.passingScorePercentSnapshot` — never accepted from the client, never re-read
   * later. `submitAttempt` grades exclusively against this frozen value, so an instructor changing
   * the live threshold after an attempt has started has zero effect on that attempt. `null` stays
   * `null` if the Quiz currently has no threshold configured.
   */
  async startAttempt(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentQuizAttemptDetail> {
    const { tenantId, quizId, enrollmentId } = await this.access.assertAccessibleQuizLesson(
      principal,
      courseId,
      lessonId,
    );
    const now = this.clock.now();

    return this.prismaService.client.$transaction(async (tx) => {
      await this.lockAttemptStart(tx, principal.userId, quizId);

      const quiz = await tx.quiz.findUniqueOrThrow({
        where: { id_tenantId: { id: quizId, tenantId } },
        select: { attemptLimit: true, passingScorePercent: true },
      });

      if (quiz.attemptLimit !== null) {
        const existingAttemptCount = await tx.quizAttempt.count({
          where: { studentUserId: principal.userId, enrollmentId, quizId },
        });

        if (existingAttemptCount >= quiz.attemptLimit) {
          throw new QuizAttemptLimitReachedError();
        }
      }

      const questions = await tx.question.findMany({
        where: { quizId, tenantId, status: QuestionStatus.ACTIVE },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          type: true,
          prompt: true,
          position: true,
          points: true,
          options: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true, label: true, text: true, position: true, isCorrect: true },
          },
        },
      });

      if (questions.length === 0) {
        throw new QuizHasNoActiveQuestionsError();
      }

      const maxAttemptNumber = await tx.quizAttempt.aggregate({
        where: { quizId, studentUserId: principal.userId },
        _max: { attemptNumber: true },
      });
      const attemptNumber = (maxAttemptNumber._max.attemptNumber ?? 0) + 1;

      const attemptId = this.uuid.create();
      await tx.quizAttempt.create({
        data: {
          id: attemptId,
          tenantId,
          quizId,
          lessonId,
          studentUserId: principal.userId,
          enrollmentId,
          status: QuizAttemptStatus.IN_PROGRESS,
          attemptNumber,
          startedAt: now,
          // Frozen once, here, from the live Quiz read moments ago inside this same locked
          // transaction — never accepted from the client. `null` stays `null` if the Quiz
          // currently has no threshold configured; it is never later backfilled from live state.
          passingScorePercentSnapshot: quiz.passingScorePercent,
        },
      });

      await tx.quizAttemptAnswer.createMany({
        data: questions.map((question) => ({
          id: this.uuid.create(),
          attemptId,
          questionId: question.id,
          questionSnapshot: toQuestionSnapshotJson(question),
          optionsSnapshot: question.options.map(toOptionSnapshotJson),
          correctAnswerSnapshot: toCorrectAnswerSnapshotJson(question.options),
          pointsAwarded: new Prisma.Decimal(0),
          pointsPossible: question.points,
        })),
      });

      const created = await tx.quizAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: ATTEMPT_DETAIL_SELECT,
      });

      return toStudentQuizAttemptDetail(created);
    });
  }

  /**
   * Ownership is proven by `(tenantId, quizId, lessonId, studentUserId)` all derived server-side
   * — a foreign/random Attempt ID, another student's Attempt, or an Attempt for a different
   * Course/Lesson/Quiz all collapse to the same `QuizAttemptNotFoundError`, matching this
   * codebase's established IDOR-avoidance convention.
   */
  async getAttempt(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
    attemptId: string,
  ): Promise<StudentQuizAttemptDetail> {
    const { tenantId, quizId } = await this.access.assertAccessibleQuizLesson(principal, courseId, lessonId);

    const attempt = await this.prismaService.client.quizAttempt.findFirst({
      where: ownedAttemptWhere(tenantId, quizId, lessonId, principal.userId, attemptId),
      select: ATTEMPT_DETAIL_SELECT,
    });

    if (!attempt) {
      throw new QuizAttemptNotFoundError();
    }

    return toStudentQuizAttemptDetail(attempt);
  }

  /**
   * Answer writes and final submission are treated as operations on the same serialized attempt
   * state: both acquire the identical transaction-scoped advisory lock keyed to `attemptId`
   * before reading attempt status, so a `saveAnswer` and a `submitAttempt` for the same attempt
   * can never interleave — whichever transaction commits second re-reads the true post-commit
   * state of the first inside its own transaction.
   *
   * Membership is validated only against this attempt's own frozen snapshot, never against live
   * `Question`/`QuestionOption` rows: a `questionId` with no corresponding `QuizAttemptAnswer`
   * row (foreign/archived/never-snapshotted question) is rejected with `QuestionNotFoundError`,
   * and an `optionId` absent from that question's own `optionsSnapshot` (e.g. belonging to a
   * different question, or never existed) is rejected with `QuestionOptionNotFoundError`. Saving
   * is idempotent and retry-safe by construction: it always `update`s the one pre-existing answer
   * row for `(attemptId, questionId)` (created at start) rather than inserting, so the same
   * answer repeated, or a different answer while still open, never creates a duplicate row.
   */
  async saveAnswer(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
    attemptId: string,
    questionId: string,
    optionId: string,
  ): Promise<StudentQuizAttemptDetail> {
    const { tenantId, quizId } = await this.access.assertAccessibleQuizLesson(principal, courseId, lessonId);

    return this.prismaService.client.$transaction(async (tx) => {
      await this.lockAttempt(tx, attemptId);

      const attempt = await tx.quizAttempt.findFirst({
        where: ownedAttemptWhere(tenantId, quizId, lessonId, principal.userId, attemptId),
        select: { id: true, status: true },
      });

      if (!attempt) {
        throw new QuizAttemptNotFoundError();
      }

      if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
        throw new QuizAttemptNotOpenError();
      }

      const answerRow = await tx.quizAttemptAnswer.findFirst({
        where: { attemptId, questionId },
        select: { id: true, optionsSnapshot: true },
      });

      if (!answerRow) {
        throw new QuestionNotFoundError();
      }

      const options = (answerRow.optionsSnapshot as unknown as OptionSnapshotJson[] | null) ?? [];
      const validOption = options.find((option) => option.optionId === optionId);

      if (!validOption) {
        throw new QuestionOptionNotFoundError();
      }

      await tx.quizAttemptAnswer.update({
        where: { id: answerRow.id },
        data: { selectedOptionIdsSnapshot: [optionId] },
      });

      const updated = await tx.quizAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        select: ATTEMPT_DETAIL_SELECT,
      });

      return toStudentQuizAttemptDetail(updated);
    });
  }

  /**
   * One atomic transaction: acquire the same per-attempt advisory lock `saveAnswer` uses, reload
   * current attempt state, and if it is no longer `IN_PROGRESS` (already `GRADED` by this or a
   * concurrent request), return the stable persisted result unchanged — never rescored, never
   * re-stamped. Otherwise score strictly from this attempt's own frozen `QuizAttemptAnswer` rows
   * (never live `Question`/`QuestionOption` state): an unanswered question or one whose selection
   * does not exactly match `correctAnswerSnapshot.correctOptionIds` awards zero points (no
   * partial credit), a matching selection awards the full frozen `pointsPossible`.
   * `passed` is computed exclusively from `QuizAttempt.passingScorePercentSnapshot` — the value
   * frozen at attempt start — and the live `Quiz.passingScorePercent` is never consulted here.
   * An instructor changing the live threshold at any point after this attempt started (whether
   * before or after this submission) has zero effect on this attempt's graded result. If the
   * snapshot is `null` (either because the Quiz genuinely had no threshold configured when this
   * attempt started, or — for the hypothetical case of a row that predates this snapshot column —
   * because no threshold could be captured), `passed` is `null`: the existing, already-defined
   * "no threshold to evaluate against" semantics are reused as-is rather than inventing a
   * fallback to live Quiz state, which would silently reintroduce the exact defect this snapshot
   * exists to prevent. All score/percentage/pass-fail computation is `Prisma.Decimal` arithmetic
   * throughout to avoid floating-point error; percentage is derived at read time from the
   * persisted `scorePoints`/`maxPoints` rather than stored separately, so it can never drift from
   * the values it is computed from.
   */
  async submitAttempt(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
    attemptId: string,
  ): Promise<StudentQuizAttemptDetail> {
    const { tenantId, quizId } = await this.access.assertAccessibleQuizLesson(principal, courseId, lessonId);

    return this.prismaService.client.$transaction(async (tx) => {
      await this.lockAttempt(tx, attemptId);

      const attempt = await tx.quizAttempt.findFirst({
        where: ownedAttemptWhere(tenantId, quizId, lessonId, principal.userId, attemptId),
        select: { id: true, status: true, passingScorePercentSnapshot: true },
      });

      if (!attempt) {
        throw new QuizAttemptNotFoundError();
      }

      if (attempt.status !== QuizAttemptStatus.IN_PROGRESS) {
        const existing = await tx.quizAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: ATTEMPT_DETAIL_SELECT,
        });
        return toStudentQuizAttemptDetail(existing);
      }

      // Scoring-only fetch: the only query in this service allowed to load
      // `correctAnswerSnapshot`, and its result never feeds a student-facing response.
      const answersForScoring = await tx.quizAttemptAnswer.findMany({
        where: { attemptId },
        select: { id: true, correctAnswerSnapshot: true, selectedOptionIdsSnapshot: true, pointsPossible: true },
      });

      let scorePoints = new Prisma.Decimal(0);
      let maxPoints = new Prisma.Decimal(0);

      for (const answer of answersForScoring) {
        const correctAnswer = answer.correctAnswerSnapshot as unknown as CorrectAnswerSnapshotJson;
        const selected = (answer.selectedOptionIdsSnapshot as unknown as string[] | null) ?? [];
        const isCorrect = isExactSelectionMatch(selected, correctAnswer.correctOptionIds);
        const pointsAwarded = isCorrect ? answer.pointsPossible : new Prisma.Decimal(0);

        await tx.quizAttemptAnswer.update({
          where: { id: answer.id },
          data: { pointsAwarded },
        });

        scorePoints = scorePoints.plus(pointsAwarded);
        maxPoints = maxPoints.plus(answer.pointsPossible);
      }

      // Graded exclusively against this attempt's own frozen threshold — the live `Quiz` row is
      // never read here. See the class-level doc comment for `null` semantics.
      const percentage = maxPoints.isZero() ? null : scorePoints.dividedBy(maxPoints).times(100);
      const passed =
        attempt.passingScorePercentSnapshot === null || percentage === null
          ? null
          : percentage.greaterThanOrEqualTo(attempt.passingScorePercentSnapshot);

      const now = this.clock.now();
      const graded = await tx.quizAttempt.update({
        where: { id: attemptId },
        data: {
          status: QuizAttemptStatus.GRADED,
          submittedAt: now,
          gradedAt: now,
          scorePoints,
          maxPoints,
          passed,
        },
        select: ATTEMPT_DETAIL_SELECT,
      });

      return toStudentQuizAttemptDetail(graded);
    });
  }

  /**
   * Serializes attempt creation per `(studentUserId, quizId)` so concurrent start requests cannot
   * compute the same `attemptNumber`. Namespaced with a distinct string prefix from
   * `lockAttempt`'s per-attempt-ID lock (and from `StudentDeviceService.lockStudentDeviceState`'s
   * per-student lock) so the three advisory-lock scopes used across this codebase cannot collide.
   */
  private async lockAttemptStart(tx: PrismaTransactionClient, studentUserId: string, quizId: string): Promise<void> {
    const key = `quiz-attempt-start:${studentUserId}:${quizId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
  }

  /**
   * Serializes every mutation (answer write, submission) against one Attempt, mirroring the
   * transaction-scoped `pg_advisory_xact_lock` pattern already established by
   * `StudentDeviceService.lockStudentDeviceState` and `QuestionOptionService`'s per-question
   * lock — a PostgreSQL implementation detail of this API service, not a cross-database
   * portability promise, and scoped narrowly to one `attemptId` so unrelated attempts never
   * contend with each other.
   */
  private async lockAttempt(tx: PrismaTransactionClient, attemptId: string): Promise<void> {
    const key = `quiz-attempt:${attemptId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
  }
}

function ownedAttemptWhere(
  tenantId: string,
  quizId: string,
  lessonId: string,
  studentUserId: string,
  attemptId: string,
): Prisma.QuizAttemptWhereInput {
  return { id: attemptId, tenantId, quizId, lessonId, studentUserId };
}

function toQuestionSnapshotJson(question: {
  id: string;
  type: QuestionType;
  prompt: string;
  position: number;
}): QuestionSnapshotJson {
  return { questionId: question.id, type: question.type, prompt: question.prompt, position: question.position };
}

function toOptionSnapshotJson(option: {
  id: string;
  label: string | null;
  text: string;
  position: number;
}): OptionSnapshotJson {
  return { optionId: option.id, label: option.label, text: option.text, position: option.position };
}

function toCorrectAnswerSnapshotJson(options: Array<{ id: string; isCorrect: boolean }>): CorrectAnswerSnapshotJson {
  return { correctOptionIds: options.filter((option) => option.isCorrect).map((option) => option.id) };
}

/** Unanswered (`selected.length === 0`) never counts as correct; otherwise an exact-set match. */
function isExactSelectionMatch(selected: string[], correct: string[]): boolean {
  if (selected.length === 0 || selected.length !== correct.length) {
    return false;
  }

  const correctSet = new Set(correct);
  return selected.every((optionId) => correctSet.has(optionId));
}

function toStudentQuizAttemptDetail(attempt: AttemptDetailRow): StudentQuizAttemptDetail {
  const sortedAnswers = [...attempt.answers].sort((a, b) => {
    const positionA = (a.questionSnapshot as unknown as QuestionSnapshotJson).position;
    const positionB = (b.questionSnapshot as unknown as QuestionSnapshotJson).position;
    if (positionA !== positionB) {
      return positionA - positionB;
    }
    return (a.questionId ?? '').localeCompare(b.questionId ?? '');
  });

  return {
    attemptId: attempt.id,
    quizId: attempt.quizId,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt ? attempt.submittedAt.toISOString() : null,
    questions: sortedAnswers.map(toStudentQuizAttemptQuestion),
    result: toStudentQuizAttemptResult(attempt),
  };
}

function toStudentQuizAttemptQuestion(answer: AttemptDetailRow['answers'][number]): StudentQuizAttemptQuestion {
  const snapshot = answer.questionSnapshot as unknown as QuestionSnapshotJson;
  const options = (answer.optionsSnapshot as unknown as OptionSnapshotJson[] | null) ?? [];
  const selected = (answer.selectedOptionIdsSnapshot as unknown as string[] | null) ?? [];

  return {
    // `questionId` is a nullable FK in the schema (SetNull if the live Question row is ever
    // deleted), but this codebase has no Question delete path — only archive — so it is always
    // populated in practice. The embedded snapshot ID is used as a defensive fallback only.
    questionId: answer.questionId ?? snapshot.questionId,
    type: snapshot.type,
    prompt: snapshot.prompt,
    position: snapshot.position,
    options: [...options]
      .sort((a, b) => (a.position !== b.position ? a.position - b.position : a.optionId.localeCompare(b.optionId)))
      .map((option) => ({ optionId: option.optionId, label: option.label, text: option.text, position: option.position })),
    selectedOptionId: selected[0] ?? null,
  };
}

function toStudentQuizAttemptResult(attempt: AttemptDetailRow): StudentQuizAttemptResult | null {
  if (attempt.status !== QuizAttemptStatus.GRADED || !attempt.gradedAt || attempt.scorePoints === null || attempt.maxPoints === null) {
    return null;
  }

  const percentage = attempt.maxPoints.isZero()
    ? null
    : attempt.scorePoints.dividedBy(attempt.maxPoints).times(100).toDecimalPlaces(2);

  return {
    scorePoints: attempt.scorePoints.toString(),
    maxPoints: attempt.maxPoints.toString(),
    percentage: percentage ? percentage.toString() : null,
    passed: attempt.passed,
    gradedAt: attempt.gradedAt.toISOString(),
  };
}
