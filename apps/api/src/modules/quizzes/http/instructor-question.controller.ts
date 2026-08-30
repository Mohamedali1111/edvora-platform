import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { CreateQuestionDto, ReorderQuestionsDto, UpdateQuestionMetadataDto } from '../dto/question.dto';
import { QuestionIdParamDto, QuizIdParamDto } from '../dto/quiz-params.dto';
import { QuestionService } from '../services/question.service';
import type { QuestionSummary } from '../types/quiz.types';

const QUESTION_THROTTLE = {
  quiz: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/quizzes/:quizId/questions')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(QUESTION_THROTTLE)
export class InstructorQuestionController {
  constructor(private readonly questions: QuestionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
    @Body() body: CreateQuestionDto,
  ): Promise<QuestionSummary> {
    return this.questions.createQuestion({
      principal,
      tenantId: params.tenantId,
      quizId: params.quizId,
      type: body.type,
      prompt: body.prompt,
      points: body.points,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
  ): Promise<{ items: QuestionSummary[] }> {
    return { items: await this.questions.listQuestions(principal, params.tenantId, params.quizId) };
  }

  @Patch(':questionId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuestionIdParamDto,
    @Body() body: UpdateQuestionMetadataDto,
  ): Promise<QuestionSummary> {
    return this.questions.updateQuestionMetadata({
      principal,
      tenantId: params.tenantId,
      quizId: params.quizId,
      questionId: params.questionId,
      prompt: body.prompt,
      points: body.points,
    });
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuizIdParamDto,
    @Body() body: ReorderQuestionsDto,
  ): Promise<{ items: QuestionSummary[] }> {
    return {
      items: await this.questions.reorderQuestions(principal, params.tenantId, params.quizId, body.questionIds),
    };
  }
}
