import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentLessonIdParamDto } from '../../courses/dto/course-params.dto';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { StudentQuizService } from '../services/student-quiz.service';
import type { StudentQuizContent } from '../types/student-quiz.types';

// Deliberately routed as a nested resource under the already-authorized Course/Lesson path
// (never a bare `/student/quizzes/:quizId`) so a Quiz can only ever be reached through the exact
// QUIZ Lesson that references it — see `StudentCourseAccessService.assertAccessibleQuizLesson`.
const STUDENT_QUIZ_THROTTLE = {
  quiz: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/courses/:courseId/lessons/:lessonId/quiz')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(STUDENT_QUIZ_THROTTLE)
export class StudentQuizController {
  constructor(private readonly studentQuizzes: StudentQuizService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getQuiz(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentLessonIdParamDto,
  ): Promise<StudentQuizContent> {
    return this.studentQuizzes.getQuizForLesson(principal, params.courseId, params.lessonId);
  }
}
