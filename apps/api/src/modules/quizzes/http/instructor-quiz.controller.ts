import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { TenantIdParamDto } from '../../tenancy/dto/uuid-param.dto';
import { CreateQuizDto, UpdateQuizMetadataDto } from '../dto/quiz.dto';
import { QuizIdParamDto } from '../dto/quiz-params.dto';
import { QuizService } from '../services/quiz.service';
import type { QuizSummary } from '../types/quiz.types';

type QuizListResponse = {
  items: QuizSummary[];
  limit: number;
  offset: number;
};

const QUIZ_THROTTLE = {
  quiz: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/quizzes')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(QUIZ_THROTTLE)
export class InstructorQuizController {
  constructor(private readonly quizzes: QuizService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: CreateQuizDto,
  ): Promise<QuizSummary> {
    return this.quizzes.createQuiz({
      principal,
      tenantId: params.tenantId,
      title: body.title,
      description: body.description,
      passingScorePercent: body.passingScorePercent,
      attemptLimit: body.attemptLimit,
      revealAnswersPolicy: body.revealAnswersPolicy,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<QuizListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.quizzes.listQuizzes(principal, params.tenantId, limit, offset),
      limit,
      offset,
    };
  }

  @Get(':quizId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
  ): Promise<QuizSummary> {
    return this.quizzes.getQuiz(principal, params.tenantId, params.quizId);
  }

  @Patch(':quizId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
    @Body() body: UpdateQuizMetadataDto,
  ): Promise<QuizSummary> {
    return this.quizzes.updateQuizMetadata({
      principal,
      tenantId: params.tenantId,
      quizId: params.quizId,
      title: body.title,
      description: body.description,
      passingScorePercent: body.passingScorePercent,
      attemptLimit: body.attemptLimit,
      revealAnswersPolicy: body.revealAnswersPolicy,
    });
  }

  @Post(':quizId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
  ): Promise<QuizSummary> {
    return this.quizzes.publishQuiz(principal, params.tenantId, params.quizId);
  }

  @Post(':quizId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
  ): Promise<QuizSummary> {
    return this.quizzes.archiveQuiz(principal, params.tenantId, params.quizId);
  }
}
