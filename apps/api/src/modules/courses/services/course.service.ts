import { Injectable } from '@nestjs/common';
import type { CourseVisibility } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError } from '../errors/course.errors';
import type { CourseSummary } from '../types/course.types';

export type CreateCourseInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  title: string;
  description?: string | null;
  thumbnailAssetRef?: string | null;
  visibility?: CourseVisibility;
};

export type UpdateCourseMetadataInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  title?: string;
  description?: string | null;
  thumbnailAssetRef?: string | null;
  visibility?: CourseVisibility;
};

@Injectable()
export class CourseService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createCourse(input: CreateCourseInput): Promise<CourseSummary> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const course = await this.prismaService.client.course.create({
      data: {
        id: this.uuid.create(),
        tenantId: input.tenantId,
        createdByUserId: input.principal.userId,
        title: input.title,
        description: input.description ?? null,
        thumbnailAssetRef: input.thumbnailAssetRef ?? null,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    });

    return toCourseSummary(course);
  }

  async listCourses(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<CourseSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const courses = await this.prismaService.client.course.findMany({
      where: { tenantId },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return courses.map(toCourseSummary);
  }

  async getCourse(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSummary> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const course = await this.prismaService.client.course.findUnique({
      where: { id_tenantId: { id: courseId, tenantId } },
    });

    if (!course) {
      throw new CourseNotFoundError();
    }

    return toCourseSummary(course);
  }

  async updateCourseMetadata(input: UpdateCourseMetadataInput): Promise<CourseSummary> {
    await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId);

    const existing = await this.prismaService.client.course.findUnique({
      where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
      select: { id: true },
    });

    if (!existing) {
      throw new CourseNotFoundError();
    }

    const course = await this.prismaService.client.course.update({
      where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.thumbnailAssetRef !== undefined
          ? { thumbnailAssetRef: input.thumbnailAssetRef }
          : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      },
    });

    return toCourseSummary(course);
  }
}

function toCourseSummary(row: {
  id: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
  status: CourseSummary['status'];
  visibility: CourseSummary['visibility'];
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CourseSummary {
  return {
    courseId: row.id,
    tenantId: row.tenantId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    description: row.description,
    thumbnailAssetRef: row.thumbnailAssetRef,
    status: row.status,
    visibility: row.visibility,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
