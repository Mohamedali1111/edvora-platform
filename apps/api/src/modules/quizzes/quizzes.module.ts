import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
// Imported only for `StudentCourseAccessService` (the one canonical student entitlement chain,
// minimally extended with `assertAccessibleQuizLesson` rather than duplicated here). CoursesModule
// does not import QuizzesModule, so this stays a one-directional dependency, not a cycle.
import { CoursesModule } from '../courses/courses.module';
import { DeviceModule } from '../devices/device.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorQuestionController } from './http/instructor-question.controller';
import { InstructorQuestionOptionController } from './http/instructor-question-option.controller';
import { InstructorQuizController } from './http/instructor-quiz.controller';
import { StudentQuizAttemptController } from './http/student-quiz-attempt.controller';
import { StudentQuizController } from './http/student-quiz.controller';
import { QuestionOptionService } from './services/question-option.service';
import { QuestionService } from './services/question.service';
import { QuizService } from './services/quiz.service';
import { StudentQuizAttemptService } from './services/student-quiz-attempt.service';
import { StudentQuizService } from './services/student-quiz.service';

@Module({
  imports: [
    AuthModule,
    CoursesModule,
    DatabaseModule,
    DeviceModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'quiz',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [
    InstructorQuizController,
    InstructorQuestionController,
    InstructorQuestionOptionController,
    StudentQuizController,
    StudentQuizAttemptController,
  ],
  providers: [QuizService, QuestionService, QuestionOptionService, StudentQuizService, StudentQuizAttemptService],
  exports: [QuizService, QuestionService, QuestionOptionService],
})
export class QuizzesModule {}
