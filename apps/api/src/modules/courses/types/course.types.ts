import type { CourseStatus, CourseVisibility } from '../../../../.generated/prisma/client';

export type CourseSummary = {
  courseId: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
  status: CourseStatus;
  visibility: CourseVisibility;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
