import { Matches } from 'class-validator';
import { StudentLessonIdParamDto } from '../../courses/dto/course-params.dto';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

// Deliberately extends the same student Course/Lesson param chain the Quiz-content-delivery route
// uses (never a bare `/student/quiz-attempts/:attemptId`) — an Attempt can only ever be reached
// through the exact authorized Course/Lesson path that owns it.
export class StudentQuizAttemptIdParamDto extends StudentLessonIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  attemptId!: string;
}

export class StudentQuizAttemptAnswerParamDto extends StudentQuizAttemptIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  questionId!: string;
}
