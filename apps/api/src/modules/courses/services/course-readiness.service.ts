import { Injectable } from '@nestjs/common';
import { LessonStatus, SectionStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { quizPublishabilitySelect } from '../../quizzes/services/quiz-publishability.util';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { CourseNotFoundError } from '../errors/course.errors';
import type { CourseReadiness } from '../types/course-readiness.types';
import { evaluateCourseReadiness } from './course-readiness.util';

@Injectable()
export class CourseReadinessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly clock: ClockService,
  ) {}

  /**
   * Server-derived Course Readiness. Reads exactly the Course's own Section/Lesson/VideoAsset/
   * DocumentAsset/Quiz relations — one bounded, nested Prisma query scaled to this Course's actual
   * structure, never a paginated tenant-wide Media/Quiz list — then hands the plain rows to the pure
   * `evaluateCourseReadiness` evaluator. Read-only: no lock is acquired (nothing here is mutated),
   * matching the instruction that readiness must not take Quiz's mutation-safety advisory lock.
   */
  async getCourseReadiness(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    courseId: string,
  ): Promise<CourseReadiness> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const course = await this.prismaService.client.course.findUnique({
      where: { id_tenantId: { id: courseId, tenantId } },
      select: { id: true },
    });

    if (!course) {
      throw new CourseNotFoundError();
    }

    const sections = await this.prismaService.client.courseSection.findMany({
      where: { courseId, tenantId, status: { not: SectionStatus.ARCHIVED } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        title: true,
        status: true,
        lessons: {
          where: { status: { not: LessonStatus.ARCHIVED } },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            title: true,
            status: true,
            type: true,
            availableFrom: true,
            availableUntil: true,
            videoLesson: {
              select: {
                videoAsset: { select: { id: true, processingStatus: true, failureCode: true } },
              },
            },
            documentLesson: {
              select: {
                documentAsset: {
                  select: { id: true, processingStatus: true, failureReason: true },
                },
              },
            },
            quizLesson: {
              select: {
                quiz: { select: { id: true, title: true, ...quizPublishabilitySelect } },
              },
            },
          },
        },
      },
    });

    const now = this.clock.now();
    const evaluation = evaluateCourseReadiness(courseId, sections, now);

    return { ...evaluation, computedAt: now };
  }
}
