import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { TenantIdParamDto } from '../../tenancy/dto/uuid-param.dto';
import { CourseIdParamDto } from '../dto/course-params.dto';
import { CreateCourseDto, UpdateCourseMetadataDto } from '../dto/course.dto';
import { CourseService } from '../services/course.service';
import type { CourseSummary } from '../types/course.types';

type CourseListResponse = {
  items: CourseSummary[];
  limit: number;
  offset: number;
};

const COURSE_THROTTLE = {
  course: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/courses')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(COURSE_THROTTLE)
export class InstructorCourseController {
  constructor(private readonly courses: CourseService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: CreateCourseDto,
  ): Promise<CourseSummary> {
    return this.courses.createCourse({
      principal,
      tenantId: params.tenantId,
      title: body.title,
      description: body.description,
      thumbnailAssetRef: body.thumbnailAssetRef,
      visibility: body.visibility,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<CourseListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.courses.listCourses(principal, params.tenantId, limit, offset),
      limit,
      offset,
    };
  }

  @Get(':courseId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: CourseIdParamDto,
  ): Promise<CourseSummary> {
    return this.courses.getCourse(principal, params.tenantId, params.courseId);
  }

  @Patch(':courseId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: CourseIdParamDto,
    @Body() body: UpdateCourseMetadataDto,
  ): Promise<CourseSummary> {
    return this.courses.updateCourseMetadata({
      principal,
      tenantId: params.tenantId,
      courseId: params.courseId,
      title: body.title,
      description: body.description,
      thumbnailAssetRef: body.thumbnailAssetRef,
      visibility: body.visibility,
    });
  }
}
