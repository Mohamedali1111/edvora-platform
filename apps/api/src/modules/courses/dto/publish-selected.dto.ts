import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, Matches } from 'class-validator';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

/**
 * Explicit first-publish selection: exactly the Section/Lesson IDs the Instructor reviewed and
 * approved for this Course's first publication (see `CoursePublishSelectedService`). Deliberately
 * accepts no quizId, no asset ID, no client-provided readiness flag, and no "exclude" list — Quiz
 * publication is always server-derived from the selected Lessons' own live relations, and the server
 * never expands or narrows this selection on its own. `@ArrayUnique()` rejects a request containing a
 * duplicate ID outright (`VALIDATION_FAILED`, matching `ReorderSectionsDto`/`ReorderLessonsDto`'s
 * existing convention) rather than silently normalizing it.
 *
 * `sectionIds` may legitimately be empty — a selected DRAFT Lesson whose Section is already
 * `PUBLISHED` needs no Section transition. `lessonIds` may not: this is a first-publish action, and an
 * empty selection can never make an empty Course "Ready to publish" (see
 * `CoursePublishSelectedService`'s doc comment).
 */
export class PublishSelectedDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  sectionIds!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(UUID_PARAM_PATTERN, { each: true })
  lessonIds!: string[];
}
