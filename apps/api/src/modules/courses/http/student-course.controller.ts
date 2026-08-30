import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { StudentCourseIdParamDto, StudentLessonIdParamDto } from '../dto/course-params.dto';
import { StudentCourseAccessService } from '../services/student-course-access.service';
import type {
  StudentCourseDetail,
  StudentCourseSummary,
  StudentLessonProgressSummary,
} from '../types/student-course.types';

type StudentCourseListResponse = {
  items: StudentCourseSummary[];
  limit: number;
  offset: number;
};

const STUDENT_COURSE_THROTTLE = {
  course: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/courses')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(STUDENT_COURSE_THROTTLE)
export class StudentCourseController {
  constructor(private readonly access: StudentCourseAccessService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<StudentCourseListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.access.listEntitledCourses(principal, limit, offset),
      limit,
      offset,
    };
  }

  @Get(':courseId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentCourseIdParamDto,
  ): Promise<StudentCourseDetail> {
    return this.access.getCourseStructure(principal, params.courseId);
  }

  @Post(':courseId/lessons/:lessonId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentLessonIdParamDto,
  ): Promise<StudentLessonProgressSummary> {
    return this.access.completeLesson(principal, params.courseId, params.lessonId);
  }
}
