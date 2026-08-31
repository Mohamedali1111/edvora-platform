import { Injectable } from '@nestjs/common';
import { QuestionType } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import { assertExactChildIdSet } from '../../courses/services/ordering.util';
import { isKnownUniqueViolation } from '../../tenancy/services/prisma-error.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  InvalidQuestionOptionReorderError,
  MultipleCorrectOptionsNotAllowedError,
  QuestionNotFoundError,
  QuestionOptionLimitExceededError,
  QuestionOptionNotFoundError,
  QuestionOptionPositionConflictError,
} from '../errors/quiz.errors';
import type { QuestionOptionSummary } from '../types/quiz.types';
import { assertPublishedQuizRemainsPublishable, lockAndAssertQuizAuthoringMutable } from './quiz-publishability.util';

export type CreateQuestionOptionInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  questionId: string;
  label?: string | null;
  text: string;
  isCorrect?: boolean;
};

export type UpdateQuestionOptionInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  questionId: string;
  optionId: string;
  label?: string | null;
  text?: string;
  isCorrect?: boolean;
};

// TRUE_FALSE questions in V1 have exactly two options (true/false); both question types use a
// single-correct-answer model — there is no schema field distinguishing single- vs multi-select
// MULTIPLE_CHOICE, so "at most one correct option" is enforced uniformly for both types.
const TRUE_FALSE_OPTION_LIMIT = 2;

const OPTION_POSITION_CONSTRAINT = 'question_options_question_id_position_key';

@Injectable()
export class QuestionOptionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createOption(input: CreateQuestionOptionInput): Promise<QuestionOptionSummary> {
    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);
        // Quiz-level lock strictly before the Question-level lock — see
        // `lockQuizPublicationBoundary`'s docstring for why this closes the publish-vs-Option
        // race and for the fixed ordering every caller of both locks must preserve.
        await lockAndAssertQuizAuthoringMutable(tx, input.tenantId, input.quizId);
        await this.lockQuestionOptionMutations(tx, input.questionId);

        const question = await tx.question.findFirst({
          where: { id: input.questionId, tenantId: input.tenantId, quizId: input.quizId },
          select: { id: true, type: true },
        });

        if (!question) {
          throw new QuestionNotFoundError();
        }

        const wantsCorrect = input.isCorrect ?? false;

        await assertValidOptionConfiguration(tx, {
          tenantId: input.tenantId,
          questionId: input.questionId,
          questionType: question.type,
          wantsCorrect,
          excludeOptionId: null,
          isNewOption: true,
        });

        const maxPosition = await tx.questionOption.aggregate({
          where: { questionId: input.questionId, tenantId: input.tenantId },
          _max: { position: true },
        });

        const option = await tx.questionOption.create({
          data: {
            id: this.uuid.create(),
            tenantId: input.tenantId,
            questionId: input.questionId,
            label: input.label ?? null,
            text: input.text,
            isCorrect: wantsCorrect,
            position: (maxPosition._max.position ?? 0) + 1,
          },
        });

        // If this Quiz is PUBLISHED, a new Option must never leave it aggregate-invalid — e.g. a
        // TRUE_FALSE question's second option landing at position 1 while a still-`isCorrect:
        // false` option exists is fine, but nothing about `assertValidOptionConfiguration` above
        // rules out every path here, so re-run the same canonical check `publishQuiz()` uses,
        // inside this same transaction/advisory-lock scope, and roll back atomically if it fails.
        await assertPublishedQuizRemainsPublishable(tx, input.tenantId, input.quizId);

        return toQuestionOptionSummary(option);
      });
    } catch (error) {
      if (
        isKnownUniqueViolation(error, OPTION_POSITION_CONSTRAINT, 'question_id', 'questionId', 'position')
      ) {
        throw new QuestionOptionPositionConflictError();
      }

      throw error;
    }
  }

  async listOptions(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
    questionId: string,
  ): Promise<QuestionOptionSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const question = await this.prismaService.client.question.findFirst({
      where: { id: questionId, tenantId, quizId },
      select: { id: true },
    });

    if (!question) {
      throw new QuestionNotFoundError();
    }

    const options = await this.prismaService.client.questionOption.findMany({
      where: { questionId, tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    return options.map(toQuestionOptionSummary);
  }

  async updateOption(input: UpdateQuestionOptionInput): Promise<QuestionOptionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);
      // Quiz-level lock strictly before the Question-level lock — same fixed ordering as
      // `createOption`; see `lockQuizPublicationBoundary`'s docstring.
      await lockAndAssertQuizAuthoringMutable(tx, input.tenantId, input.quizId);
      await this.lockQuestionOptionMutations(tx, input.questionId);

      const question = await tx.question.findFirst({
        where: { id: input.questionId, tenantId: input.tenantId, quizId: input.quizId },
        select: { id: true, type: true },
      });

      if (!question) {
        throw new QuestionNotFoundError();
      }

      // QuestionOption has no (id, tenantId) composite unique key at all in the schema (only
      // (questionId, position)) — `findFirst` combining id + tenantId + questionId is the
      // correct, safety-equivalent proof, for the same reason as Question above.
      const existing = await tx.questionOption.findFirst({
        where: { id: input.optionId, tenantId: input.tenantId, questionId: input.questionId },
      });

      if (!existing) {
        throw new QuestionOptionNotFoundError();
      }

      if (input.isCorrect === false) {
        await assertValidOptionConfiguration(tx, {
          tenantId: input.tenantId,
          questionId: input.questionId,
          questionType: question.type,
          wantsCorrect: input.isCorrect,
          excludeOptionId: existing.id,
          isNewOption: false,
        });
      }

      if (input.isCorrect === true) {
        await tx.questionOption.updateMany({
          where: {
            tenantId: input.tenantId,
            questionId: input.questionId,
            id: { not: existing.id },
            isCorrect: true,
          },
          data: { isCorrect: false },
        });
      }

      const updated = await tx.questionOption.update({
        where: { id: existing.id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.isCorrect !== undefined ? { isCorrect: input.isCorrect } : {}),
        },
      });

      // Selecting a correct option is radio-style: clear siblings, set this option, then let the
      // canonical PUBLISHED aggregate check accept or roll back the final state.
      await assertPublishedQuizRemainsPublishable(tx, input.tenantId, input.quizId);

      return toQuestionOptionSummary(updated);
    });
  }

  /**
   * Serializes every mutation that can change the "at most one correct option" / "TRUE_FALSE has
   * at most two options" invariants for one Question, using the same transaction-scoped
   * PostgreSQL advisory-lock pattern already established by
   * `StudentDeviceService.lockStudentDeviceState` — no schema change, no new infrastructure.
   * `pg_advisory_xact_lock` blocks a second concurrent transaction locking the same `questionId`
   * hash until the first commits or rolls back, so the option-count/correctness reads in
   * `assertValidOptionConfiguration` are guaranteed consistent with what actually gets written:
   * a losing concurrent request re-reads state *after* the winner's commit, correctly observes
   * the now-invalid resulting configuration, and is rejected with the same clean domain error a
   * sequential request would get — never a raw Prisma/PostgreSQL error. Scoped to `questionId`,
   * not global, so concurrent authoring on different Questions (or different Quizzes) never
   * blocks on each other. Reordering is deliberately excluded: it only changes `position`, never
   * `isCorrect` or the option count, so it cannot violate either invariant.
   */
  private async lockQuestionOptionMutations(tx: PrismaTransactionClient, questionId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${questionId}, 0::bigint))`;
  }

  async reorderOptions(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
    questionId: string,
    optionIds: string[],
  ): Promise<QuestionOptionSummary[]> {
    try {
      return await this.reorderOptionsInTransaction(principal, tenantId, quizId, questionId, optionIds);
    } catch (error) {
      if (
        isKnownUniqueViolation(error, OPTION_POSITION_CONSTRAINT, 'question_id', 'questionId', 'position')
      ) {
        throw new QuestionOptionPositionConflictError();
      }

      throw error;
    }
  }

  private async reorderOptionsInTransaction(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
    questionId: string,
    optionIds: string[],
  ): Promise<QuestionOptionSummary[]> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);
      await lockAndAssertQuizAuthoringMutable(tx, tenantId, quizId);

      const question = await tx.question.findFirst({
        where: { id: questionId, tenantId, quizId },
        select: { id: true },
      });

      if (!question) {
        throw new QuestionNotFoundError();
      }

      // QuestionOption has no status/archive concept in the schema — the "current children"
      // set is simply every option row for this question (no status filter is possible or
      // needed).
      const [options, maxPositionRow] = await Promise.all([
        tx.questionOption.findMany({
          where: { questionId, tenantId },
          select: { id: true, position: true },
        }),
        tx.questionOption.aggregate({
          where: { questionId, tenantId },
          _max: { position: true },
        }),
      ]);

      assertExactChildIdSet(
        options.map((option) => option.id),
        optionIds,
        () => new InvalidQuestionOptionReorderError(),
      );

      const temporaryBase = (maxPositionRow._max.position ?? 0) + 1;
      const finalPositions = options.map((option) => option.position).sort((a, b) => a - b);

      await Promise.all(
        optionIds.map((optionId, index) =>
          tx.questionOption.update({
            where: { id: optionId },
            data: { position: temporaryBase + index },
          }),
        ),
      );

      await Promise.all(
        optionIds.map((optionId, index) =>
          tx.questionOption.update({
            where: { id: optionId },
            data: { position: finalPositions[index] },
          }),
        ),
      );

      const updated = await tx.questionOption.findMany({
        where: { questionId, tenantId },
        orderBy: { position: 'asc' },
      });

      return updated.map(toQuestionOptionSummary);
    });
  }
}

/**
 * Centrally enforces the two type-specific QuestionOption invariants, atomically within the
 * caller's transaction, before any write occurs:
 *  - a TRUE_FALSE question may never have more than two options;
 *  - at most one option per question may be marked correct (uniform across both supported
 *    question types, since neither the schema nor this milestone distinguishes single- vs
 *    multi-select MULTIPLE_CHOICE).
 * This is a best-effort application-level check (SELECT then, in the same transaction, INSERT/
 * UPDATE) rather than a DB-enforced constraint — no partial unique index or CHECK constraint for
 * either rule exists in the current schema, and adding one would require a migration, which is
 * out of scope for this slice. It is fully correct for sequential requests (the normal case) and
 * has a narrow, documented race window only under genuinely concurrent duplicate submissions for
 * the same question, which is a data-quality risk local to the authoring instructor, not a
 * cross-tenant or student-facing security boundary.
 */
async function assertValidOptionConfiguration(
  tx: PrismaTransactionClient,
  input: {
    tenantId: string;
    questionId: string;
    questionType: QuestionType;
    wantsCorrect: boolean;
    excludeOptionId: string | null;
    isNewOption: boolean;
  },
): Promise<void> {
  if (input.isNewOption && input.questionType === QuestionType.TRUE_FALSE) {
    const existingCount = await tx.questionOption.count({
      where: { questionId: input.questionId, tenantId: input.tenantId },
    });

    if (existingCount >= TRUE_FALSE_OPTION_LIMIT) {
      throw new QuestionOptionLimitExceededError();
    }
  }

  if (input.wantsCorrect) {
    const alreadyCorrect = await tx.questionOption.findFirst({
      where: {
        questionId: input.questionId,
        tenantId: input.tenantId,
        isCorrect: true,
        ...(input.excludeOptionId ? { id: { not: input.excludeOptionId } } : {}),
      },
      select: { id: true },
    });

    if (alreadyCorrect) {
      throw new MultipleCorrectOptionsNotAllowedError();
    }
  }
}

function toQuestionOptionSummary(option: {
  id: string;
  questionId: string;
  label: string | null;
  text: string;
  position: number;
  isCorrect: boolean;
  createdAt: Date;
  updatedAt: Date;
}): QuestionOptionSummary {
  return {
    optionId: option.id,
    questionId: option.questionId,
    label: option.label,
    text: option.text,
    position: option.position,
    isCorrect: option.isCorrect,
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  };
}
