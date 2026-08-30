import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentLessonIdParamDto } from '../../courses/dto/course-params.dto';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { SaveQuizAttemptAnswerDto } from '../dto/student-quiz-attempt.dto';
import {
  StudentQuizAttemptAnswerParamDto,
  StudentQuizAttemptIdParamDto,
} from '../dto/student-quiz-attempt-params.dto';
import { StudentQuizAttemptService } from '../services/student-quiz-attempt.service';
import type { StudentQuizAttemptDetail } from '../types/student-quiz-attempt.types';

// Deliberately nested under the same Course/Lesson-bound Quiz path Slice B established (never a
// bare `/student/quiz-attempts/:attemptId`) — an Attempt can only ever be reached through the
// exact authorized QUIZ Lesson it was started from.
const STUDENT_QUIZ_ATTEMPT_THROTTLE = {
  quiz: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/courses/:courseId/lessons/:lessonId/quiz/attempts')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(STUDENT_QUIZ_ATTEMPT_THROTTLE)
export class StudentQuizAttemptController {
  constructor(private readonly attempts: StudentQuizAttemptService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentLessonIdParamDto,
  ): Promise<StudentQuizAttemptDetail> {
    return this.attempts.startAttempt(principal, params.courseId, params.lessonId);
  }

  @Get(':attemptId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentQuizAttemptIdParamDto,
  ): Promise<StudentQuizAttemptDetail> {
    return this.attempts.getAttempt(principal, params.courseId, params.lessonId, params.attemptId);
  }

  @Put(':attemptId/answers/:questionId')
  @HttpCode(HttpStatus.OK)
  async saveAnswer(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentQuizAttemptAnswerParamDto,
    @Body() body: SaveQuizAttemptAnswerDto,
  ): Promise<StudentQuizAttemptDetail> {
    return this.attempts.saveAnswer(
      principal,
      params.courseId,
      params.lessonId,
      params.attemptId,
      params.questionId,
      body.optionId,
    );
  }

  @Post(':attemptId/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentQuizAttemptIdParamDto,
  ): Promise<StudentQuizAttemptDetail> {
    return this.attempts.submitAttempt(principal, params.courseId, params.lessonId, params.attemptId);
  }
}
