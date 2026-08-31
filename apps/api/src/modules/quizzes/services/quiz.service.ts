import { Injectable } from '@nestjs/common';
import {
  QuizStatus,
  type QuizRevealAnswersPolicy,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { InvalidQuizLifecycleTransitionError, QuizNotFoundError } from '../errors/quiz.errors';
import type { QuizSummary } from '../types/quiz.types';
import { assertQuizPublishable, lockQuizPublicationBoundary, quizPublishabilitySelect } from './quiz-publishability.util';

export type CreateQuizInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  title: string;
  description?: string | null;
  passingScorePercent?: number | null;
  attemptLimit?: number | null;
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
};

export type UpdateQuizMetadataInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  quizId: string;
  title?: string;
  description?: string | null;
  passingScorePercent?: number | null;
  attemptLimit?: number | null;
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
};

@Injectable()
export class QuizService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
    private readonly clock: ClockService,
  ) {}

  async createQuiz(input: CreateQuizInput): Promise<QuizSummary> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const quiz = await this.prismaService.client.quiz.create({
      data: {
        id: this.uuid.create(),
        tenantId: input.tenantId,
        title: input.title,
        description: input.description ?? null,
        passingScorePercent: input.passingScorePercent ?? null,
        attemptLimit: input.attemptLimit ?? null,
        ...(input.revealAnswersPolicy ? { revealAnswersPolicy: input.revealAnswersPolicy } : {}),
      },
    });

    return toQuizSummary(quiz);
  }

  async listQuizzes(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<QuizSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const quizzes = await this.prismaService.client.quiz.findMany({
      where: { tenantId },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return quizzes.map(toQuizSummary);
  }

  async getQuiz(principal: AuthenticatedPrincipal, tenantId: string, quizId: string): Promise<QuizSummary> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const quiz = await this.prismaService.client.quiz.findUnique({
      where: { id_tenantId: { id: quizId, tenantId } },
    });

    if (!quiz) {
      throw new QuizNotFoundError();
    }

    return toQuizSummary(quiz);
  }

  // Deliberately not re-running `assertQuizPublishable` here: the only two fields this method
  // touches that the publishability rules care about — `passingScorePercent` and `attemptLimit`
  // — are already fully range-constrained at the DTO layer (`UpdateQuizMetadataDto`:
  // `@Min(0) @Max(100)` on `passingScorePercent`, `@IsInt() @Min(1)` on `attemptLimit`, both
  // `@IsOptional()` so `null`/omitted are the only other values that reach here — and both
  // `assertQuizPublishable` and this DTO treat `null` identically, as "no constraint"). No value
  // this method can ever persist for either field can violate the aggregate invariant, so there
  // is nothing for a post-mutation check to catch; `title`/`description`/`revealAnswersPolicy`
  // play no role in publishability at all. If either DTO's range validation is ever loosened,
  // this method must be revisited alongside it.
  async updateQuizMetadata(input: UpdateQuizMetadataInput): Promise<QuizSummary> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const existing = await this.prismaService.client.quiz.findUnique({
      where: { id_tenantId: { id: input.quizId, tenantId: input.tenantId } },
      select: { id: true },
    });

    if (!existing) {
      throw new QuizNotFoundError();
    }

    const quiz = await this.prismaService.client.quiz.update({
      where: { id_tenantId: { id: input.quizId, tenantId: input.tenantId } },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.passingScorePercent !== undefined ? { passingScorePercent: input.passingScorePercent } : {}),
        ...(input.attemptLimit !== undefined ? { attemptLimit: input.attemptLimit } : {}),
        ...(input.revealAnswersPolicy !== undefined ? { revealAnswersPolicy: input.revealAnswersPolicy } : {}),
      },
    });

    return toQuizSummary(quiz);
  }

  async publishQuiz(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
  ): Promise<QuizSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);
      // Must be acquired before the read below — see `lockQuizPublicationBoundary`'s docstring
      // for the exact publish-vs-mutation race this closes.
      await lockQuizPublicationBoundary(tx, quizId);

      const quiz = await tx.quiz.findUnique({
        where: { id_tenantId: { id: quizId, tenantId } },
        select: quizPublishabilitySelect,
      });

      if (!quiz) {
        throw new QuizNotFoundError();
      }

      if (quiz.status === QuizStatus.ARCHIVED) {
        throw new InvalidQuizLifecycleTransitionError();
      }

      assertQuizPublishable(quiz);

      if (quiz.status === QuizStatus.DRAFT) {
        const updated = await tx.quiz.updateMany({
          where: { id: quizId, tenantId, status: QuizStatus.DRAFT },
          data: { status: QuizStatus.PUBLISHED, publishedAt: this.clock.now() },
        });

        if (updated.count !== 1) {
          const current = await tx.quiz.findUniqueOrThrow({
            where: { id_tenantId: { id: quizId, tenantId } },
            select: { status: true },
          });
          if (current.status === QuizStatus.ARCHIVED) {
            throw new InvalidQuizLifecycleTransitionError();
          }
        }
      }

      const published = await tx.quiz.findUniqueOrThrow({
        where: { id_tenantId: { id: quizId, tenantId } },
      });

      return toQuizSummary(published);
    });
  }

  async archiveQuiz(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    quizId: string,
  ): Promise<QuizSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const existing = await tx.quiz.findUnique({
        where: { id_tenantId: { id: quizId, tenantId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new QuizNotFoundError();
      }

      if (existing.status !== QuizStatus.ARCHIVED) {
        await tx.quiz.updateMany({
          where: { id: quizId, tenantId, status: { in: [QuizStatus.DRAFT, QuizStatus.PUBLISHED] } },
          data: { status: QuizStatus.ARCHIVED },
        });
      }

      const quiz = await tx.quiz.findUniqueOrThrow({
        where: { id_tenantId: { id: quizId, tenantId } },
      });

      return toQuizSummary(quiz);
    });
  }
}

function toQuizSummary(quiz: {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: QuizSummary['status'];
  passingScorePercent: { toString(): string } | null;
  attemptLimit: number | null;
  revealAnswersPolicy: QuizSummary['revealAnswersPolicy'];
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): QuizSummary {
  return {
    quizId: quiz.id,
    tenantId: quiz.tenantId,
    title: quiz.title,
    description: quiz.description,
    status: quiz.status,
    passingScorePercent: quiz.passingScorePercent?.toString() ?? null,
    attemptLimit: quiz.attemptLimit,
    revealAnswersPolicy: quiz.revealAnswersPolicy,
    publishedAt: quiz.publishedAt,
    createdAt: quiz.createdAt,
    updatedAt: quiz.updatedAt,
  };
}
