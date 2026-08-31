import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { QuizNotFoundError } from '../errors/quiz.errors';
import type { InstructorQuizAttemptSummary } from '../types/instructor-quiz-attempt.types';

export type ListQuizAttemptsInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  studentUserId?: string;
  passed?: boolean;
  limit: number;
  offset: number;
};

// Deliberately never selects `QuizAttemptAnswer` or any of its snapshot fields
// (`correctAnswerSnapshot`, `pointsAwarded`, etc.) — aggregate reporting only, matching
// `StudentQuizAttemptService`'s existing `ATTEMPT_ANSWER_SAFE_SELECT`/`ATTEMPT_DETAIL_SELECT`
// discipline of never loading answer-key data into a query whose result feeds an HTTP response
// unless that specific query is the scoring-only path. Per-question detail is out of scope for
// this V1 reporting slice.
const ATTEMPT_REPORT_SELECT = {
  id: true,
  quizId: true,
  enrollmentId: true,
  studentUserId: true,
  status: true,
  attemptNumber: true,
  scorePoints: true,
  maxPoints: true,
  passed: true,
  startedAt: true,
  submittedAt: true,
  createdAt: true,
  student: { select: { email: true, displayName: true, accountStatus: true } },
} satisfies Prisma.QuizAttemptSelect;

type AttemptReportRow = Prisma.QuizAttemptGetPayload<{ select: typeof ATTEMPT_REPORT_SELECT }>;

@Injectable()
export class InstructorQuizAttemptService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
  ) {}

  /**
   * Instructor V1 Quiz results report: every legitimate Attempt for this Quiz/tenant, IN_PROGRESS
   * included — an instructor genuinely benefits from seeing an attempt underway, not only
   * finished ones, and nothing here fabricates a status the schema doesn't have: `status` is
   * read straight from the persisted `QuizAttemptStatus` column (`IN_PROGRESS`/`SUBMITTED`/
   * `GRADED`/`ABANDONED`), and `scorePoints`/`maxPoints`/`percentage`/`passed` are simply `null`
   * on the response for any attempt the grading step in `StudentQuizAttemptService.submitAttempt`
   * has not yet populated — never re-derived, never backfilled from the live Quiz.
   *
   * Historical grading integrity: every score/max/percentage/passed value is read directly off
   * the persisted `QuizAttempt` row, the exact snapshot `submitAttempt` computed and stored at
   * that attempt's own grading time from that attempt's own frozen `QuizAttemptAnswer` snapshots.
   * This method never re-grades, never re-joins the live `Question`/`QuestionOption` state, and
   * a later instructor edit to a PUBLISHED Quiz (or even the mutation-safety repair rejecting an
   * edit) has no way to reach or alter an already-persisted Attempt row — the same guarantee
   * `docs/QUIZ-ATTEMPTS.md` already documents for the student-facing read.
   *
   * One bounded query for the page itself (`take`/`skip`, `select`-projected, no N+1) after one
   * Quiz-existence check; `studentUserId`/`passed` filters are plain relational `WHERE` clauses,
   * not validated against a separate existence check — an unmatched filter value safely yields an
   * empty page (no existence leakage risk, since it reveals nothing not already implied by "zero
   * attempts").
   */
  async listAttempts(input: ListQuizAttemptsInput): Promise<InstructorQuizAttemptSummary[]> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const quiz = await this.prismaService.client.quiz.findUnique({
      where: { id_tenantId: { id: input.quizId, tenantId: input.tenantId } },
      select: { id: true },
    });

    if (!quiz) {
      throw new QuizNotFoundError();
    }

    const rows = await this.prismaService.client.quizAttempt.findMany({
      where: {
        tenantId: input.tenantId,
        quizId: input.quizId,
        ...(input.studentUserId ? { studentUserId: input.studentUserId } : {}),
        ...(input.passed !== undefined ? { passed: input.passed } : {}),
      },
      select: ATTEMPT_REPORT_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: input.limit,
      skip: input.offset,
    });

    return rows.map(toInstructorQuizAttemptSummary);
  }
}

function toInstructorQuizAttemptSummary(row: AttemptReportRow): InstructorQuizAttemptSummary {
  const percentage =
    row.scorePoints !== null && row.maxPoints !== null && !row.maxPoints.isZero()
      ? row.scorePoints.dividedBy(row.maxPoints).times(100).toDecimalPlaces(2).toString()
      : null;

  return {
    attemptId: row.id,
    quizId: row.quizId,
    enrollmentId: row.enrollmentId,
    student: {
      studentUserId: row.studentUserId,
      email: row.student.email,
      displayName: row.student.displayName,
      accountStatus: row.student.accountStatus,
    },
    status: row.status,
    attemptNumber: row.attemptNumber,
    scorePoints: row.scorePoints !== null ? row.scorePoints.toString() : null,
    maxPoints: row.maxPoints !== null ? row.maxPoints.toString() : null,
    percentage,
    passed: row.passed,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
  };
}
