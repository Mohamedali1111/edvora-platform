import { Matches } from 'class-validator';
import { TenantIdParamDto, UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class CourseIdParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  courseId!: string;
}

export class SectionIdParamDto extends CourseIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  sectionId!: string;
}

export class LessonIdParamDto extends SectionIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  lessonId!: string;
}

// Student course routes intentionally have no tenantId path segment — the tenant is always
// derived server-side from the course/enrollment relationship, never accepted from the client.
export class StudentCourseIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  courseId!: string;
}

export class StudentLessonIdParamDto extends StudentCourseIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  lessonId!: string;
}
