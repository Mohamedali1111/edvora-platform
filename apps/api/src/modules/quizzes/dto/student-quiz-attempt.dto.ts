import { Matches } from 'class-validator';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

// Single-select only: every V1 QuestionType (MULTIPLE_CHOICE, TRUE_FALSE) allows at most one
// correct Option (enforced by instructor authoring), so the client contract mirrors that — one
// selected Option ID, never an array. Internally this is stored as a one-element array to match
// the schema's `selectedOptionIdsSnapshot` shape, but nothing here invents multi-select.
export class SaveQuizAttemptAnswerDto {
  @Matches(UUID_PARAM_PATTERN)
  optionId!: string;
}
