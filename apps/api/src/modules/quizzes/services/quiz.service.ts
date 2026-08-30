import { Injectable } from '@nestjs/common';
import type { QuizRevealAnswersPolicy } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { QuizNotFoundError } from '../errors/quiz.errors';
import type { QuizSummary } from '../types/quiz.types';

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
