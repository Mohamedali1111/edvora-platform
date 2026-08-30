import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { CreateQuestionOptionDto, ReorderQuestionOptionsDto, UpdateQuestionOptionDto } from '../dto/question-option.dto';
import { QuestionIdParamDto, QuestionOptionIdParamDto } from '../dto/quiz-params.dto';
import { QuestionOptionService } from '../services/question-option.service';
import type { QuestionOptionSummary } from '../types/quiz.types';

const QUESTION_OPTION_THROTTLE = {
  quiz: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/quizzes/:quizId/questions/:questionId/options')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(QUESTION_OPTION_THROTTLE)
export class InstructorQuestionOptionController {
  constructor(private readonly options: QuestionOptionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuestionIdParamDto,
    @Body() body: CreateQuestionOptionDto,
  ): Promise<QuestionOptionSummary> {
    return this.options.createOption({
      principal,
      tenantId: params.tenantId,
      quizId: params.quizId,
      questionId: params.questionId,
      label: body.label,
      text: body.text,
      isCorrect: body.isCorrect,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuestionIdParamDto,
  ): Promise<{ items: QuestionOptionSummary[] }> {
    return {
      items: await this.options.listOptions(principal, params.tenantId, params.quizId, params.questionId),
    };
  }

  @Patch(':optionId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuestionOptionIdParamDto,
    @Body() body: UpdateQuestionOptionDto,
  ): Promise<QuestionOptionSummary> {
    return this.options.updateOption({
      principal,
      tenantId: params.tenantId,
      quizId: params.quizId,
      questionId: params.questionId,
      optionId: params.optionId,
      label: body.label,
      text: body.text,
      isCorrect: body.isCorrect,
    });
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: QuestionIdParamDto,
    @Body() body: ReorderQuestionOptionsDto,
  ): Promise<{ items: QuestionOptionSummary[] }> {
    return {
      items: await this.options.reorderOptions(
        principal,
        params.tenantId,
        params.quizId,
        params.questionId,
        body.optionIds,
      ),
    };
  }
}
