import { Injectable } from '@nestjs/common';
import { AssetProcessingStatus, LessonStatus, LessonType, QuizStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { isKnownUniqueViolation } from '../../tenancy/services/prisma-error.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  InvalidLessonReorderError,
  InvalidLessonLifecycleTransitionError,
  InvalidLessonTypeReferenceError,
  LessonContentNotReadyError,
  LessonNotFoundError,
  LessonPositionConflictError,
  LessonReferenceNotFoundError,
  SectionNotFoundError,
} from '../errors/course.errors';
import type { LessonSummary } from '../types/course.types';
import { assertExactChildIdSet } from './ordering.util';

export type CreateLessonInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  sectionId: string;
  title: string;
  description?: string | null;
  type: LessonType;
  videoAssetId?: string;
  documentAssetId?: string;
  quizId?: string;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
};

export type UpdateLessonMetadataInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  courseId: string;
  sectionId: string;
  lessonId: string;
  title?: string;
  description?: string | null;
  availableFrom?: Date | null;
  availableUntil?: Date | null;
};

type LessonWithDetails = {
  id: string;
  tenantId: string;
  courseId: string;
  sectionId: string;
  title: string;
  description: string | null;
  type: LessonType;
  position: number;
  status: LessonStatus;
  availableFrom: Date | null;
  availableUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
  videoLesson: { videoAssetId: string } | null;
  documentLesson: { documentAssetId: string } | null;
  quizLesson: { quizId: string } | null;
};

const LESSON_DETAIL_INCLUDE = {
  videoLesson: { select: { videoAssetId: true } },
  documentLesson: { select: { documentAssetId: true } },
  quizLesson: { select: { quizId: true } },
} as const;

const LESSON_POSITION_CONSTRAINT = 'lessons_section_id_position_key';

@Injectable()
export class LessonService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createLesson(input: CreateLessonInput): Promise<LessonSummary> {
    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

        const section = await tx.courseSection.findFirst({
          where: { id: input.sectionId, courseId: input.courseId, tenantId: input.tenantId },
          select: { id: true },
        });

        if (!section) {
          throw new SectionNotFoundError();
        }

        assertSingleTypeReference(input);

        if (input.type === LessonType.VIDEO) {
          const asset = await tx.videoAsset.findUnique({
            where: { id_tenantId: { id: input.videoAssetId as string, tenantId: input.tenantId } },
            select: { id: true },
          });

          if (!asset) {
            throw new LessonReferenceNotFoundError();
          }
        } else if (input.type === LessonType.DOCUMENT) {
          const asset = await tx.documentAsset.findUnique({
            where: {
              id_tenantId: { id: input.documentAssetId as string, tenantId: input.tenantId },
            },
            select: { id: true },
          });

          if (!asset) {
            throw new LessonReferenceNotFoundError();
          }
        } else {
          const quiz = await tx.quiz.findUnique({
            where: { id_tenantId: { id: input.quizId as string, tenantId: input.tenantId } },
            select: { id: true },
          });

          if (!quiz) {
            throw new LessonReferenceNotFoundError();
          }
        }

        const maxPosition = await tx.lesson.aggregate({
          where: {
            sectionId: input.sectionId,
            courseId: input.courseId,
            tenantId: input.tenantId,
            status: { not: LessonStatus.ARCHIVED },
          },
          _max: { position: true },
        });

        const lessonId = this.uuid.create();

        await tx.lesson.create({
          data: {
            id: lessonId,
            tenantId: input.tenantId,
            courseId: input.courseId,
            sectionId: input.sectionId,
            title: input.title,
            description: input.description ?? null,
            type: input.type,
            position: (maxPosition._max.position ?? 0) + 1,
            availableFrom: input.availableFrom ?? null,
            availableUntil: input.availableUntil ?? null,
          },
        });

        if (input.type === LessonType.VIDEO) {
          await tx.videoLesson.create({
            data: { lessonId, tenantId: input.tenantId, videoAssetId: input.videoAssetId as string },
          });
        } else if (input.type === LessonType.DOCUMENT) {
          await tx.documentLesson.create({
            data: {
              lessonId,
              tenantId: input.tenantId,
              documentAssetId: input.documentAssetId as string,
            },
          });
        } else {
          await tx.quizLesson.create({
            data: { lessonId, tenantId: input.tenantId, quizId: input.quizId as string },
          });
        }

        const created = await tx.lesson.findUniqueOrThrow({
          where: { id: lessonId },
          include: LESSON_DETAIL_INCLUDE,
        });

        return toLessonSummary(created);
      });
    } catch (error) {
      if (
        isKnownUniqueViolation(error, LESSON_POSITION_CONSTRAINT, 'section_id', 'sectionId', 'position')
      ) {
        throw new LessonPositionConflictError();
      }

      throw error;
    }
  }

  async listLessons(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
  ): Promise<LessonSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const section = await this.prismaService.client.courseSection.findFirst({
      where: { id: sectionId, courseId, tenantId },
      select: { id: true },
    });

    if (!section) {
      throw new SectionNotFoundError();
    }

    const lessons = await this.prismaService.client.lesson.findMany({
      where: { sectionId, courseId, tenantId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: LESSON_DETAIL_INCLUDE,
    });

    return lessons.map(toLessonSummary);
  }

  // DEC-0048: ordinary authoring edits are allowed for non-archived resources only.
  // Transactional + a conditional `updateMany` (status != ARCHIVED) rather than a
  // plain read-then-write, so a concurrent archiveLesson() cannot land between the
  // existence check and the write and leave an ARCHIVED lesson metadata-mutated.
  async updateLessonMetadata(input: UpdateLessonMetadataInput): Promise<LessonSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

      const existing = await tx.lesson.findFirst({
        where: {
          id: input.lessonId,
          sectionId: input.sectionId,
          courseId: input.courseId,
          tenantId: input.tenantId,
        },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new LessonNotFoundError();
      }

      if (existing.status === LessonStatus.ARCHIVED) {
        throw new InvalidLessonLifecycleTransitionError();
      }

      const updated = await tx.lesson.updateMany({
        where: {
          id: input.lessonId,
          sectionId: input.sectionId,
          courseId: input.courseId,
          tenantId: input.tenantId,
          status: { not: LessonStatus.ARCHIVED },
        },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
          ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
        },
      });

      if (updated.count !== 1) {
        throw new InvalidLessonLifecycleTransitionError();
      }

      const lesson = await tx.lesson.findUniqueOrThrow({
        where: { id_tenantId_courseId: { id: input.lessonId, tenantId: input.tenantId, courseId: input.courseId } },
        include: LESSON_DETAIL_INCLUDE,
      });

      return toLessonSummary(lesson);
    });
  }

  async archiveLesson(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
    lessonId: string,
  ): Promise<LessonSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const lesson = await tx.lesson.findFirst({
        where: { id: lessonId, sectionId, courseId, tenantId },
        include: LESSON_DETAIL_INCLUDE,
      });

      if (!lesson) {
        throw new LessonNotFoundError();
      }

      if (lesson.status === LessonStatus.ARCHIVED) {
        return toLessonSummary(lesson);
      }

      await tx.lesson.updateMany({
        where: {
          id: lessonId,
          sectionId,
          courseId,
          tenantId,
          status: { in: [LessonStatus.DRAFT, LessonStatus.PUBLISHED] },
        },
        data: { status: LessonStatus.ARCHIVED },
      });

      const archived = await tx.lesson.findUniqueOrThrow({
        where: { id_tenantId_courseId: { id: lessonId, tenantId, courseId } },
        include: LESSON_DETAIL_INCLUDE,
      });

      return toLessonSummary(archived);
    });
  }

  async publishLesson(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
    lessonId: string,
  ): Promise<LessonSummary> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const lesson = await tx.lesson.findFirst({
        where: { id: lessonId, sectionId, courseId, tenantId },
        include: {
          videoLesson: { include: { videoAsset: { select: { processingStatus: true } } } },
          documentLesson: { include: { documentAsset: { select: { processingStatus: true } } } },
          quizLesson: { include: { quiz: { select: { status: true } } } },
        },
      });

      if (!lesson) {
        throw new LessonNotFoundError();
      }

      if (lesson.status === LessonStatus.ARCHIVED) {
        throw new InvalidLessonLifecycleTransitionError();
      }

      assertLessonPublishable(lesson);

      if (lesson.status === LessonStatus.DRAFT) {
        const updated = await tx.lesson.updateMany({
          where: { id: lessonId, sectionId, courseId, tenantId, status: LessonStatus.DRAFT },
          data: { status: LessonStatus.PUBLISHED },
        });

        if (updated.count !== 1) {
          const current = await tx.lesson.findUniqueOrThrow({
            where: { id_tenantId_courseId: { id: lessonId, tenantId, courseId } },
            select: { status: true },
          });
          if (current.status === LessonStatus.ARCHIVED) {
            throw new InvalidLessonLifecycleTransitionError();
          }
        }
      }

      const published = await tx.lesson.findUniqueOrThrow({
        where: { id_tenantId_courseId: { id: lessonId, tenantId, courseId } },
        include: LESSON_DETAIL_INCLUDE,
      });

      return toLessonSummary(published);
    });
  }

  async reorderLessons(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
    lessonIds: string[],
  ): Promise<LessonSummary[]> {
    try {
      return await this.reorderLessonsInTransaction(principal, tenantId, courseId, sectionId, lessonIds);
    } catch (error) {
      // Same class of race as CourseSectionService.reorderSections: two concurrent reorder
      // requests for the same section can compute the same temporary base and collide on the
      // same (sectionId, position) values. Handle it the same narrow way createLesson does.
      if (
        isKnownUniqueViolation(error, LESSON_POSITION_CONSTRAINT, 'section_id', 'sectionId', 'position')
      ) {
        throw new LessonPositionConflictError();
      }

      throw error;
    }
  }

  private async reorderLessonsInTransaction(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
    sectionId: string,
    lessonIds: string[],
  ): Promise<LessonSummary[]> {
    return this.prismaService.client.$transaction(async (tx) => {
      await this.authorization.assertInstructorTenantAccess(principal, tenantId, tx);

      const section = await tx.courseSection.findFirst({
        where: { id: sectionId, courseId, tenantId },
        select: { id: true },
      });

      if (!section) {
        throw new SectionNotFoundError();
      }

      const [activeLessons, maxPositionRow] = await Promise.all([
        tx.lesson.findMany({
          where: { sectionId, courseId, tenantId, status: { not: LessonStatus.ARCHIVED } },
          select: { id: true, position: true },
        }),
        tx.lesson.aggregate({
          where: { sectionId, courseId, tenantId },
          _max: { position: true },
        }),
      ]);

      assertExactChildIdSet(
        activeLessons.map((lesson) => lesson.id),
        lessonIds,
        () => new InvalidLessonReorderError(),
      );

      // Same safe two-phase resequence as CourseSectionService.reorderSections, and for the
      // same reason: `(sectionId, position)` is a plain, non-partial unique index that also
      // constrains ARCHIVED rows, so literal final positions 1..N could collide with an
      // archived sibling's retained position. Phase two instead reassigns the existing
      // active-position value set (sorted) to the submitted order, which preserves the
      // requested relative order while being provably collision-free. Phase one first moves
      // every affected row above the current max (active + archived).
      const temporaryBase = (maxPositionRow._max.position ?? 0) + 1;
      const finalPositions = activeLessons.map((lesson) => lesson.position).sort((a, b) => a - b);

      await Promise.all(
        lessonIds.map((lessonId, index) =>
          tx.lesson.update({
            where: { id_tenantId_courseId: { id: lessonId, tenantId, courseId } },
            data: { position: temporaryBase + index },
          }),
        ),
      );

      await Promise.all(
        lessonIds.map((lessonId, index) =>
          tx.lesson.update({
            where: { id_tenantId_courseId: { id: lessonId, tenantId, courseId } },
            data: { position: finalPositions[index] },
          }),
        ),
      );

      const updated = await tx.lesson.findMany({
        where: { sectionId, courseId, tenantId, status: { not: LessonStatus.ARCHIVED } },
        orderBy: { position: 'asc' },
        include: LESSON_DETAIL_INCLUDE,
      });

      return updated.map(toLessonSummary);
    });
  }
}

function assertSingleTypeReference(input: {
  type: LessonType;
  videoAssetId?: string;
  documentAssetId?: string;
  quizId?: string;
}): void {
  const provided = [input.videoAssetId, input.documentAssetId, input.quizId].filter(
    (value): value is string => value !== undefined && value !== null,
  );

  if (provided.length !== 1) {
    throw new InvalidLessonTypeReferenceError();
  }

  const referenceMatchesType =
    (input.type === LessonType.VIDEO && input.videoAssetId !== undefined) ||
    (input.type === LessonType.DOCUMENT && input.documentAssetId !== undefined) ||
    (input.type === LessonType.QUIZ && input.quizId !== undefined);

  if (!referenceMatchesType) {
    throw new InvalidLessonTypeReferenceError();
  }
}

function assertLessonPublishable(lesson: {
  type: LessonType;
  videoLesson: { videoAsset: { processingStatus: AssetProcessingStatus } } | null;
  documentLesson: { documentAsset: { processingStatus: AssetProcessingStatus } } | null;
  quizLesson: { quiz: { status: QuizStatus } } | null;
}): void {
  if (
    lesson.type === LessonType.VIDEO &&
    lesson.videoLesson?.videoAsset.processingStatus === AssetProcessingStatus.READY
  ) {
    return;
  }

  if (
    lesson.type === LessonType.DOCUMENT &&
    lesson.documentLesson?.documentAsset.processingStatus === AssetProcessingStatus.READY
  ) {
    return;
  }

  if (lesson.type === LessonType.QUIZ && lesson.quizLesson?.quiz.status === QuizStatus.PUBLISHED) {
    return;
  }

  throw new LessonContentNotReadyError();
}

function toLessonSummary(row: LessonWithDetails): LessonSummary {
  return {
    lessonId: row.id,
    tenantId: row.tenantId,
    courseId: row.courseId,
    sectionId: row.sectionId,
    title: row.title,
    description: row.description,
    type: row.type,
    position: row.position,
    status: row.status,
    availableFrom: row.availableFrom,
    availableUntil: row.availableUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    videoAssetId: row.videoLesson?.videoAssetId ?? null,
    documentAssetId: row.documentLesson?.documentAssetId ?? null,
    quizId: row.quizLesson?.quizId ?? null,
  };
}
