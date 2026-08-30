import { Injectable } from '@nestjs/common';
import { QuestionStatus, QuestionType } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
// Reused as-is from the Course module's proven, reviewed reorder-validation utility rather than
// duplicated — see apps/api/src/modules/courses/services/ordering.util.ts.
import { assertExactChildIdSet } from '../../courses/services/ordering.util';
import { isKnownUniqueViolation } from '../../tenancy/services/prisma-error.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { InvalidQuestionReorderError, QuestionNotFoundError, QuestionPositionConflictError, QuizNotFoundError } from '../errors/quiz.errors';
import type { QuestionSummary } from '../types/quiz.types';

export type CreateQuestionInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  type: QuestionType;
  prompt: string;
  points: number;
};

export type UpdateQuestionMetadataInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  questionId: string;
  prompt?: string;
  points?: number;
};

const QUESTION_POSITION_CONSTRAINT = 'questions_quiz_id_position_key';

@Injectable()
export class QuestionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createQuestion(input: CreateQuestionInput): Promise<QuestionSummary> {
    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

        const quiz = await tx.quiz.findUnique({
          where: { id_tenantId: { id: input.quizId, tenantId: input.tenantId } },
          select: { id: true },
        });

        if (!quiz) {
          throw new QuizNotFoundError();
        }

        const maxPosition = await tx.question.aggregate({
          where: {
            quizId: input.quizId,
            tenantId: input.tenantId,
            status: { not: QuestionStatus.ARCHIVED },
          },
          _max: { position: true },
        });

        const question = await tx.question.create({
          data: {
            id: this.uuid.create(),
            tenantId: input.tenantId,
            quizId: input.quizId,
            type: input.type,
            prompt: input.prompt,
            points: input.points,
            position: (maxPosition._max.position ?? 0) + 1,
          },
        });

        return toQuestionSummary(question);
      });
    } catch (error) {
      if (
        isKnownUniqueViolation(error, QUESTION_POSITION_CONSTRAINT, 'quiz_id', 'quizId', 'position')
      ) {
        throw new QuestionPositionConflictError();
      }

      throw error;
    }
  }

  async listQuestions(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
  ): Promise<QuestionSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const quiz = await this.prismaService.client.quiz.findUnique({
      where: { id_tenantId: { id: quizId, tenantId } },
      select: { id: true },
    });

    if (!quiz) {
      throw new QuizNotFoundError();
    }

    const questions = await this.prismaService.client.question.findMany({
      where: { quizId, tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    return questions.map(toQuestionSummary);
  }

  async updateQuestionMetadata(input: UpdateQuestionMetadataInput): Promise<QuestionSummary> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    // Question has no (id, quizId, tenantId) composite unique key in the schema (only
    // (id, tenantId) and (quizId, position)) — `findFirst` combining all three ownership
    // dimensions in one WHERE is the correct, safety-equivalent proof: `id` is already the
    // primary key, so ANDing tenantId/quizId can only narrow the result to 0 or 1 rows, never
    // admit a foreign one. Mirrors the identical pattern already reviewed and approved for
    // Lesson in the Course module.
    const existing = await this.prismaService.client.question.findFirst({
      where: { id: input.questionId, tenantId: input.tenantId, quizId: input.quizId },
      select: { id: true },
    });

    if (!existing) {
      throw new QuestionNotFoundError();
    }

    const question = await this.prismaService.client.question.update({
      where: { id_tenantId: { id: input.questionId, tenantId: input.tenantId } },
      data: {
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.points !== undefined ? { points: input.points } : {}),
      },
    });

    return toQuestionSummary(question);
  }

  async reorderQuestions(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
    questionIds: string[],
  ): Promise<QuestionSummary[]> {
    try {
      return await this.reorderQuestionsInTransaction(principal, tenantId, quizId, questionIds);
    } catch (error) {
      // Two concurrent reorder requests for the same quiz can compute the same temporary base
      // and collide on the same (quizId, position) values — the same class of "known expected
      // uniqueness conflict" createQuestion already handles; reuse the identical narrow catch.
      if (
        isKnownUniqueViolation(error, QUESTION_POSITION_CONSTRAINT, 'quiz_id', 'quizId', 'position')
      ) {
        throw new QuestionPositionConflictError();
      }

      throw error;
    }
  }

  private async reorderQuestionsInTransaction(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
    questionIds: string[],
  ): Promise<QuestionSummary[]> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const quiz = await tx.quiz.findUnique({
        where: { id_tenantId: { id: quizId, tenantId } },
        select: { id: true },
      });

      if (!quiz) {
        throw new QuizNotFoundError();
      }

      const [activeQuestions, maxPositionRow] = await Promise.all([
        tx.question.findMany({
          where: { quizId, tenantId, status: { not: QuestionStatus.ARCHIVED } },
          select: { id: true, position: true },
        }),
        tx.question.aggregate({
          where: { quizId, tenantId },
          _max: { position: true },
        }),
      ]);

      assertExactChildIdSet(
        activeQuestions.map((question) => question.id),
        questionIds,
        () => new InvalidQuestionReorderError(),
      );

      // Same safe two-phase resequence as the Course module's Section/Lesson reorder, and for
      // the same reason: `(quizId, position)` is a plain, non-partial unique index that would
      // also constrain any future ARCHIVED question, so literal final positions 1..N could
      // collide with an archived sibling's retained position. Reassigning the existing
      // active-position value set (sorted) to the submitted order preserves the requested
      // relative order while being provably collision-free.
      const temporaryBase = (maxPositionRow._max.position ?? 0) + 1;
      const finalPositions = activeQuestions.map((question) => question.position).sort((a, b) => a - b);

      await Promise.all(
        questionIds.map((questionId, index) =>
          tx.question.update({
            where: { id_tenantId: { id: questionId, tenantId } },
            data: { position: temporaryBase + index },
          }),
        ),
      );

      await Promise.all(
        questionIds.map((questionId, index) =>
          tx.question.update({
            where: { id_tenantId: { id: questionId, tenantId } },
            data: { position: finalPositions[index] },
          }),
        ),
      );

      const updated = await tx.question.findMany({
        where: { quizId, tenantId, status: { not: QuestionStatus.ARCHIVED } },
        orderBy: { position: 'asc' },
      });

      return updated.map(toQuestionSummary);
    });
  }
}

function toQuestionSummary(question: {
  id: string;
  quizId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  points: { toString(): string };
  status: QuestionStatus;
  createdAt: Date;
  updatedAt: Date;
}): QuestionSummary {
  return {
    questionId: question.id,
    quizId: question.quizId,
    type: question.type,
    prompt: question.prompt,
    position: question.position,
    points: question.points.toString(),
    status: question.status,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}
