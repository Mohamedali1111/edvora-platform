import { Matches } from 'class-validator';
import { TenantIdParamDto, UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class QuizIdParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  quizId!: string;
}

export class QuestionIdParamDto extends QuizIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  questionId!: string;
}

export class QuestionOptionIdParamDto extends QuestionIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  optionId!: string;
}
