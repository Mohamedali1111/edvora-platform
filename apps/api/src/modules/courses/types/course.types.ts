import type {
  CourseStatus,
  CourseVisibility,
  LessonStatus,
  LessonType,
  SectionStatus,
} from '../../../../.generated/prisma/client';

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

export type CourseSectionSummary = {
  sectionId: string;
  tenantId: string;
  courseId: string;
  title: string;
  description: string | null;
  position: number;
  status: SectionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type LessonSummary = {
  lessonId: string;
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
  videoAssetId: string | null;
  documentAssetId: string | null;
  quizId: string | null;
};
