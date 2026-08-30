import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorQuestionController } from './http/instructor-question.controller';
import { InstructorQuestionOptionController } from './http/instructor-question-option.controller';
import { InstructorQuizController } from './http/instructor-quiz.controller';
import { QuestionOptionService } from './services/question-option.service';
import { QuestionService } from './services/question.service';
import { QuizService } from './services/quiz.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'quiz',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [InstructorQuizController, InstructorQuestionController, InstructorQuestionOptionController],
  providers: [QuizService, QuestionService, QuestionOptionService],
  exports: [QuizService, QuestionService, QuestionOptionService],
})
export class QuizzesModule {}
