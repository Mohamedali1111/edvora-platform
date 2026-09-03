import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { LessonIdParamDto, SectionIdParamDto } from '../dto/course-params.dto';
import { CreateLessonDto, ReorderLessonsDto, UpdateLessonMetadataDto } from '../dto/lesson.dto';
import { LessonService } from '../services/lesson.service';
import type { LessonSummary } from '../types/course.types';

const LESSON_THROTTLE = {
  course: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/courses/:courseId/sections/:sectionId/lessons')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(LESSON_THROTTLE)
export class InstructorLessonController {
  constructor(private readonly lessons: LessonService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
    @Body() body: CreateLessonDto,
  ): Promise<LessonSummary> {
    return this.lessons.createLesson({
      principal,
      tenantId: params.tenantId,
      courseId: params.courseId,
      sectionId: params.sectionId,
      title: body.title,
      description: body.description,
      type: body.type,
      videoAssetId: body.videoAssetId,
      documentAssetId: body.documentAssetId,
      quizId: body.quizId,
      availableFrom: body.availableFrom ? new Date(body.availableFrom) : null,
      availableUntil: body.availableUntil ? new Date(body.availableUntil) : null,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
  ): Promise<{ items: LessonSummary[] }> {
    return {
      items: await this.lessons.listLessons(
        principal,
        params.tenantId,
        params.courseId,
        params.sectionId,
      ),
    };
  }

  @Patch(':lessonId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: LessonIdParamDto,
    @Body() body: UpdateLessonMetadataDto,
  ): Promise<LessonSummary> {
    return this.lessons.updateLessonMetadata({
      principal,
      tenantId: params.tenantId,
      courseId: params.courseId,
      sectionId: params.sectionId,
      lessonId: params.lessonId,
      title: body.title,
      description: body.description,
      availableFrom:
        body.availableFrom !== undefined ? (body.availableFrom ? new Date(body.availableFrom) : null) : undefined,
      availableUntil:
        body.availableUntil !== undefined
          ? body.availableUntil
            ? new Date(body.availableUntil)
            : null
          : undefined,
    });
  }

  @Post(':lessonId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: LessonIdParamDto,
  ): Promise<LessonSummary> {
    return this.lessons.archiveLesson(
      principal,
      params.tenantId,
      params.courseId,
      params.sectionId,
      params.lessonId,
    );
  }

  @Post(':lessonId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: LessonIdParamDto,
  ): Promise<LessonSummary> {
    return this.lessons.publishLesson(
      principal,
      params.tenantId,
      params.courseId,
      params.sectionId,
      params.lessonId,
    );
  }

  @Post(':lessonId/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: LessonIdParamDto,
  ): Promise<LessonSummary> {
    return this.lessons.unpublishLesson(
      principal,
      params.tenantId,
      params.courseId,
      params.sectionId,
      params.lessonId,
    );
  }

  @Post(':lessonId/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: LessonIdParamDto,
  ): Promise<LessonSummary> {
    return this.lessons.restoreLesson(
      principal,
      params.tenantId,
      params.courseId,
      params.sectionId,
      params.lessonId,
    );
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
    @Body() body: ReorderLessonsDto,
  ): Promise<{ items: LessonSummary[] }> {
    return {
      items: await this.lessons.reorderLessons(
        principal,
        params.tenantId,
        params.courseId,
        params.sectionId,
        body.lessonIds,
      ),
    };
  }
}
