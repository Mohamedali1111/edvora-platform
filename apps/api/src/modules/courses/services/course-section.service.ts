import { Injectable } from '@nestjs/common';
import { SectionStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { isKnownUniqueViolation } from '../../tenancy/services/prisma-error.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  CourseNotFoundError,
  InvalidSectionReorderError,
  InvalidSectionLifecycleTransitionError,
  SectionNotFoundError,
  SectionPositionConflictError,
} from '../errors/course.errors';
import type { CourseSectionSummary } from '../types/course.types';
import { assertExactChildIdSet } from './ordering.util';

export type CreateSectionInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  title: string;
  description?: string | null;
};

export type UpdateSectionMetadataInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  sectionId: string;
  title?: string;
  description?: string | null;
};

const SECTION_POSITION_CONSTRAINT = 'course_sections_course_id_position_key';

@Injectable()
export class CourseSectionService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createSection(input: CreateSectionInput): Promise<CourseSectionSummary> {
    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

        const course = await tx.course.findUnique({
          where: { id_tenantId: { id: input.courseId, tenantId: input.tenantId } },
          select: { id: true },
        });

        if (!course) {
          throw new CourseNotFoundError();
        }

        const maxPosition = await tx.courseSection.aggregate({
          where: {
            courseId: input.courseId,
            tenantId: input.tenantId,
            status: { not: SectionStatus.ARCHIVED },
          },
          _max: { position: true },
        });

        const section = await tx.courseSection.create({
          data: {
            id: this.uuid.create(),
            tenantId: input.tenantId,
            courseId: input.courseId,
            title: input.title,
            description: input.description ?? null,
            position: (maxPosition._max.position ?? 0) + 1,
          },
        });

        return toSectionSummary(section);
      });
    } catch (error) {
      if (
        isKnownUniqueViolation(
          error,
          SECTION_POSITION_CONSTRAINT,
          'course_id',
          'courseId',
          'position',
        )
      ) {
        throw new SectionPositionConflictError();
      }

      throw error;
    }
  }

  async listSections(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseSectionSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const course = await this.prismaService.client.course.findUnique({
      where: { id_tenantId: { id: courseId, tenantId } },
      select: { id: true },
    });

    if (!course) {
      throw new CourseNotFoundError();
    }

    const sections = await this.prismaService.client.courseSection.findMany({
      where: { courseId, tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    return sections.map(toSectionSummary);
  }

  // DEC-0048: ordinary authoring edits are allowed for non-archived resources only.
  // Transactional + a conditional `updateMany` (status != ARCHIVED) rather than a
  // plain read-then-write, so a concurrent archiveSection() cannot land between the
  // existence check and the write and leave an ARCHIVED section metadata-mutated.
  async updateSectionMetadata(input: UpdateSectionMetadataInput): Promise<CourseSectionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

      const existing = await tx.courseSection.findUnique({
        where: {
          id_courseId_tenantId: {
            id: input.sectionId,
            courseId: input.courseId,
            tenantId: input.tenantId,
          },
        },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new SectionNotFoundError();
      }

      if (existing.status === SectionStatus.ARCHIVED) {
        throw new InvalidSectionLifecycleTransitionError();
      }

      const updated = await tx.courseSection.updateMany({
        where: {
          id: input.sectionId,
          courseId: input.courseId,
          tenantId: input.tenantId,
          status: { not: SectionStatus.ARCHIVED },
        },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });

      if (updated.count !== 1) {
        throw new InvalidSectionLifecycleTransitionError();
      }

      const section = await tx.courseSection.findUniqueOrThrow({
        where: {
          id_courseId_tenantId: {
            id: input.sectionId,
            courseId: input.courseId,
            tenantId: input.tenantId,
          },
        },
      });

      return toSectionSummary(section);
    });
  }

  async archiveSection(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
  ): Promise<CourseSectionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const section = await tx.courseSection.findUnique({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
      });

      if (!section) {
        throw new SectionNotFoundError();
      }

      if (section.status === SectionStatus.ARCHIVED) {
        return toSectionSummary(section);
      }

      await tx.courseSection.updateMany({
        where: {
          id: sectionId,
          courseId,
          tenantId,
          status: { in: [SectionStatus.DRAFT, SectionStatus.PUBLISHED] },
        },
        data: { status: SectionStatus.ARCHIVED },
      });

      const archived = await tx.courseSection.findUniqueOrThrow({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
      });

      return toSectionSummary(archived);
    });
  }

  async publishSection(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
  ): Promise<CourseSectionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const section = await tx.courseSection.findUnique({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!section) {
        throw new SectionNotFoundError();
      }

      if (section.status === SectionStatus.ARCHIVED) {
        throw new InvalidSectionLifecycleTransitionError();
      }

      if (section.status === SectionStatus.DRAFT) {
        const updated = await tx.courseSection.updateMany({
          where: { id: sectionId, courseId, tenantId, status: SectionStatus.DRAFT },
          data: { status: SectionStatus.PUBLISHED },
        });

        if (updated.count !== 1) {
          const current = await tx.courseSection.findUniqueOrThrow({
            where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === SectionStatus.ARCHIVED) {
            throw new InvalidSectionLifecycleTransitionError();
          }
        }
      }

      const published = await tx.courseSection.findUniqueOrThrow({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
      });

      return toSectionSummary(published);
    });
  }

  async unpublishSection(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
  ): Promise<CourseSectionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const section = await tx.courseSection.findUnique({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!section) {
        throw new SectionNotFoundError();
      }

      if (section.status === SectionStatus.ARCHIVED) {
        throw new InvalidSectionLifecycleTransitionError();
      }

      if (section.status === SectionStatus.PUBLISHED) {
        const updated = await tx.courseSection.updateMany({
          where: { id: sectionId, courseId, tenantId, status: SectionStatus.PUBLISHED },
          data: { status: SectionStatus.DRAFT },
        });

        if (updated.count !== 1) {
          const current = await tx.courseSection.findUniqueOrThrow({
            where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === SectionStatus.ARCHIVED) {
            throw new InvalidSectionLifecycleTransitionError();
          }
        }
      }

      const unpublished = await tx.courseSection.findUniqueOrThrow({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
      });

      return toSectionSummary(unpublished);
    });
  }

  async restoreSection(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
  ): Promise<CourseSectionSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const section = await tx.courseSection.findUnique({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
        select: { id: true, status: true },
      });

      if (!section) {
        throw new SectionNotFoundError();
      }

      if (section.status === SectionStatus.PUBLISHED) {
        throw new InvalidSectionLifecycleTransitionError();
      }

      if (section.status === SectionStatus.ARCHIVED) {
        const updated = await tx.courseSection.updateMany({
          where: { id: sectionId, courseId, tenantId, status: SectionStatus.ARCHIVED },
          data: { status: SectionStatus.DRAFT },
        });

        if (updated.count !== 1) {
          const current = await tx.courseSection.findUniqueOrThrow({
            where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
            select: { status: true },
          });
          if (current.status === SectionStatus.PUBLISHED) {
            throw new InvalidSectionLifecycleTransitionError();
          }
        }
      }

      const restored = await tx.courseSection.findUniqueOrThrow({
        where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
      });

      return toSectionSummary(restored);
    });
  }

  async reorderSections(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionIds: string[],
  ): Promise<CourseSectionSummary[]> {
    try {
      return await this.reorderSectionsInTransaction(principal, tenantId, courseId, sectionIds);
    } catch (error) {
      // Two concurrent reorder requests for the same course (e.g. a double-submit) can each
      // compute the same temporary base from the same pre-update snapshot under READ COMMITTED,
      // then race on the same (courseId, position) values during the temporary-move phase. This
      // is the same class of "known expected uniqueness conflict" createSection already handles;
      // reorder needs the identical narrow catch rather than surfacing a raw 500.
      if (
        isKnownUniqueViolation(
          error,
          SECTION_POSITION_CONSTRAINT,
          'course_id',
          'courseId',
          'position',
        )
      ) {
        throw new SectionPositionConflictError();
      }

      throw error;
    }
  }

  private async reorderSectionsInTransaction(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionIds: string[],
  ): Promise<CourseSectionSummary[]> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const course = await tx.course.findUnique({
        where: { id_tenantId: { id: courseId, tenantId } },
        select: { id: true },
      });

      if (!course) {
        throw new CourseNotFoundError();
      }

      const [activeSections, maxPositionRow] = await Promise.all([
        tx.courseSection.findMany({
          where: { courseId, tenantId, status: { not: SectionStatus.ARCHIVED } },
          select: { id: true, position: true },
        }),
        tx.courseSection.aggregate({
          where: { courseId, tenantId },
          _max: { position: true },
        }),
      ]);

      assertExactChildIdSet(
        activeSections.map((section) => section.id),
        sectionIds,
        () => new InvalidSectionReorderError(),
      );

      // Two-phase resequence. `(courseId, position)` is a plain, non-partial unique index
      // that also constrains ARCHIVED rows (confirmed in the applied migration SQL), so an
      // archived sibling can permanently hold a low position value (e.g. sections 1,2,3 with
      // #2 archived leaves positions 1 and 3 active). Assigning literal final positions 1..N
      // could therefore collide with an archived row's retained position. Instead, phase two
      // reassigns the *existing* active-position value set (sorted) to the submitted order:
      // those values are already proven free of archived-row conflicts, so reusing them keeps
      // the requested relative order while guaranteeing no collision, without weakening the
      // constraint. Phase one first moves every affected row into a temporary range strictly
      // above the current max (active + archived), so no intermediate write in either phase
      // can violate the unique constraint.
      const temporaryBase = (maxPositionRow._max.position ?? 0) + 1;
      const finalPositions = activeSections.map((section) => section.position).sort((a, b) => a - b);

      await Promise.all(
        sectionIds.map((sectionId, index) =>
          tx.courseSection.update({
            where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
            data: { position: temporaryBase + index },
          }),
        ),
      );

      await Promise.all(
        sectionIds.map((sectionId, index) =>
          tx.courseSection.update({
            where: { id_courseId_tenantId: { id: sectionId, courseId, tenantId } },
            data: { position: finalPositions[index] },
          }),
        ),
      );

      const updated = await tx.courseSection.findMany({
        where: { courseId, tenantId, status: { not: SectionStatus.ARCHIVED } },
        orderBy: { position: 'asc' },
      });

      return updated.map(toSectionSummary);
    });
  }
}

function toSectionSummary(row: {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
  status: SectionStatus;
  createdAt: Date;
  updatedAt: Date;
}): CourseSectionSummary {
  return {
    sectionId: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
