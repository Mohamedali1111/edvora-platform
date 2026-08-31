import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { CourseIdParamDto, SectionIdParamDto } from '../dto/course-params.dto';
import { CreateSectionDto, ReorderSectionsDto, UpdateSectionMetadataDto } from '../dto/section.dto';
import { CourseSectionService } from '../services/course-section.service';
import type { CourseSectionSummary } from '../types/course.types';

const SECTION_THROTTLE = {
  course: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/courses/:courseId/sections')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(SECTION_THROTTLE)
export class InstructorSectionController {
  constructor(private readonly sections: CourseSectionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: CourseIdParamDto,
    @Body() body: CreateSectionDto,
  ): Promise<CourseSectionSummary> {
    return this.sections.createSection({
      principal,
      tenantId: params.tenantId,
      courseId: params.courseId,
      title: body.title,
      description: body.description,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: CourseIdParamDto,
  ): Promise<{ items: CourseSectionSummary[] }> {
    return { items: await this.sections.listSections(principal, params.tenantId, params.courseId) };
  }

  @Patch(':sectionId')
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
    @Body() body: UpdateSectionMetadataDto,
  ): Promise<CourseSectionSummary> {
    return this.sections.updateSectionMetadata({
      principal,
      tenantId: params.tenantId,
      courseId: params.courseId,
      sectionId: params.sectionId,
      title: body.title,
      description: body.description,
    });
  }

  @Post(':sectionId/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
  ): Promise<CourseSectionSummary> {
    return this.sections.archiveSection(principal, params.tenantId, params.courseId, params.sectionId);
  }

  @Post(':sectionId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: SectionIdParamDto,
  ): Promise<CourseSectionSummary> {
    return this.sections.publishSection(principal, params.tenantId, params.courseId, params.sectionId);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: CourseIdParamDto,
    @Body() body: ReorderSectionsDto,
  ): Promise<{ items: CourseSectionSummary[] }> {
    return {
      items: await this.sections.reorderSections(
        principal,
        params.tenantId,
        params.courseId,
        body.sectionIds,
      ),
    };
  }
}
