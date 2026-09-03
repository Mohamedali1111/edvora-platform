import { Injectable } from '@nestjs/common';
import { CourseStatus, type CourseVisibility } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError, InvalidCourseLifecycleTransitionError } from '../errors/course.errors';
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
    private readonly clock: ClockService,
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
  ): Promise<{ items: CourseSummary[]; hasMore: boolean }> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const rows = await this.prismaService.client.course.findMany({
      where: { tenantId },
      take: limit + 1,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const { items, hasMore } = trimToOffsetPage(rows, limit);

    return { items: items.map(toCourseSummary), hasMore };
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

  // DEC-0048: ordinary authoring edits are allowed for non-archived resources only.
  // Transactional + a conditional `updateMany` (status != ARCHIVED) rather than a
  // plain read-then-write, so a concurrent archiveCourse() cannot land between the
  // existence check and the write and leave an ARCHIVED course metadata-mutated.
  async updateCourseMetadata(input: UpdateCourseMetadataInput): Promise<CourseSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

      const existing = await tx.course.findUnique({
        where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new CourseNotFoundError();
      }

      if (existing.status === CourseStatus.ARCHIVED) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      const updated = await tx.course.updateMany({
        where: { id: input.courseId, tenantId: input.tenantId, status: { not: CourseStatus.ARCHIVED } },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.thumbnailAssetRef !== undefined
            ? { thumbnailAssetRef: input.thumbnailAssetRef }
            : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        },
      });

      if (updated.count !== 1) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      const course = await tx.course.findUniqueOrThrow({
        where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
      });

      return toCourseSummary(course);
    });
  }

  async publishCourse(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const existing = await tx.course.findUnique({
        where: { id_tenantId: { id: courseId, tenantId } },
        select: { id: true, status: true, publishedAt: true },
      });

      if (!existing) {
        throw new CourseNotFoundError();
      }

      if (existing.status === CourseStatus.ARCHIVED) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      if (existing.status === CourseStatus.DRAFT) {
        const updated = await tx.course.updateMany({
          where: { id: courseId, tenantId, status: CourseStatus.DRAFT },
          data: { status: CourseStatus.PUBLISHED, publishedAt: this.clock.now() },
        });

        if (updated.count !== 1) {
          const current = await tx.course.findUniqueOrThrow({
            where: { id_tenantId: { id: courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === CourseStatus.ARCHIVED) {
            throw new InvalidCourseLifecycleTransitionError();
          }
        }
      }

      const course = await tx.course.findUniqueOrThrow({
        where: { id_tenantId: { id: courseId, tenantId } },
      });

      return toCourseSummary(course);
    });
  }

  async archiveCourse(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const existing = await tx.course.findUnique({
        where: { id_tenantId: { id: courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new CourseNotFoundError();
      }

      if (existing.status !== CourseStatus.ARCHIVED) {
        await tx.course.updateMany({
          where: { id: courseId, tenantId, status: { in: [CourseStatus.DRAFT, CourseStatus.PUBLISHED] } },
          data: { status: CourseStatus.ARCHIVED, archivedAt: this.clock.now() },
        });
      }

      const course = await tx.course.findUniqueOrThrow({
        where: { id_tenantId: { id: courseId, tenantId } },
      });

      return toCourseSummary(course);
    });
  }

  async unpublishCourse(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const existing = await tx.course.findUnique({
        where: { id_tenantId: { id: courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new CourseNotFoundError();
      }

      if (existing.status === CourseStatus.ARCHIVED) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      if (existing.status === CourseStatus.PUBLISHED) {
        const updated = await tx.course.updateMany({
          where: { id: courseId, tenantId, status: CourseStatus.PUBLISHED },
          data: { status: CourseStatus.DRAFT },
        });

        if (updated.count !== 1) {
          const current = await tx.course.findUniqueOrThrow({
            where: { id_tenantId: { id: courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === CourseStatus.ARCHIVED) {
            throw new InvalidCourseLifecycleTransitionError();
          }
        }
      }

      const course = await tx.course.findUniqueOrThrow({
        where: { id_tenantId: { id: courseId, tenantId } },
      });

      return toCourseSummary(course);
    });
  }

  async restoreCourse(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const existing = await tx.course.findUnique({
        where: { id_tenantId: { id: courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new CourseNotFoundError();
      }

      if (existing.status === CourseStatus.PUBLISHED) {
        throw new InvalidCourseLifecycleTransitionError();
      }

      if (existing.status === CourseStatus.ARCHIVED) {
        const updated = await tx.course.updateMany({
          where: { id: courseId, tenantId, status: CourseStatus.ARCHIVED },
          data: { status: CourseStatus.DRAFT },
        });

        if (updated.count !== 1) {
          const current = await tx.course.findUniqueOrThrow({
            where: { id_tenantId: { id: courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === CourseStatus.PUBLISHED) {
            throw new InvalidCourseLifecycleTransitionError();
          }
        }
      }

      const course = await tx.course.findUniqueOrThrow({
        where: { id_tenantId: { id: courseId, tenantId } },
      });

      return toCourseSummary(course);
    });
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
