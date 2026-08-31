import type { EnrollmentStatus } from '../../../../.generated/prisma/client';
import type { StudentContactSummary } from '../../tenancy/types/tenancy.types';

/**
 * One row per Enrollment in an instructor's course-progress report — reuses the exact same
 * `StudentContactSummary` boundary already approved for Enrollment Visibility (never broadens
 * instructor-facing student PII exposure). `completedLessons`/`totalLessons`/`progressPercent`
 * are derived at read time, never persisted — see `CourseProgressService.listCourseProgress`'s
 * doc comment for the exact denominator/numerator/lastActivityAt definitions.
 */
export type CourseProgressRow = {
  enrollmentId: string;
  status: EnrollmentStatus;
  // The exact canonical Enrollment-row entitlement predicate (see
  // `InstructorEnrollmentSummary.currentlyEffective` in the tenancy module) — not full student
  // entitlement (Course/Tenant/TenantStudent status are not re-checked here).
  currentlyEffective: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  student: StudentContactSummary;
  completedLessons: number;
  totalLessons: number;
  // 0–100, rounded to 2 decimal places. Always exactly 0 when `totalLessons` is 0 — never NaN,
  // never null.
  progressPercent: number;
  lastActivityAt: Date | null;
};
