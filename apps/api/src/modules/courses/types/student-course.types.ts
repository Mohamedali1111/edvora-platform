import type {
  AssetProcessingStatus,
  LessonProgressStatus,
  LessonType,
  QuizStatus,
} from '../../../../.generated/prisma/client';

/**
 * Student-facing response shapes are deliberately separate from the instructor `CourseSummary`/
 * `CourseSectionSummary`/`LessonSummary` family: instructors need authoring fields (status,
 * visibility, ownership, position-of-archived-items) that a student must never see, and a
 * student must never see provider/storage internals (asset IDs, provider keys, external
 * references) that the instructor-facing types intentionally do expose as safe authoring
 * metadata. Every field below has been reviewed to be safe to return to an entitled student.
 */

export type StudentCourseSummary = {
  courseId: string;
  tenantId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
};

export type StudentVideoLessonMetadata = {
  processingStatus: AssetProcessingStatus;
  durationSeconds: number | null;
};

export type StudentDocumentLessonMetadata = {
  fileName: string;
  mimeType: string;
  // Serialized as a decimal string: Prisma returns BigInt for this column, which JSON.stringify
  // cannot serialize directly.
  fileSizeBytes: string;
};

export type StudentQuizLessonMetadata = {
  title: string;
  status: QuizStatus;
};

// A missing LessonProgress row is represented as NOT_STARTED with no completedAt — a row is
// never created merely to serve a read. `progress` intentionally omits video watch-time/resume
// fields and the internal LessonProgress ID; only what the app needs to render lesson state.
export type StudentLessonProgress = {
  status: LessonProgressStatus;
  completedAt: Date | null;
};

export type StudentLessonSummary = {
  lessonId: string;
  sectionId: string;
  title: string;
  description: string | null;
  type: LessonType;
  position: number;
  video: StudentVideoLessonMetadata | null;
  document: StudentDocumentLessonMetadata | null;
  quiz: StudentQuizLessonMetadata | null;
  progress: StudentLessonProgress;
};

export type StudentLessonProgressSummary = {
  lessonId: string;
  status: LessonProgressStatus;
  completedAt: Date | null;
};

export type StudentSectionSummary = {
  sectionId: string;
  title: string;
  description: string | null;
  position: number;
  lessons: StudentLessonSummary[];
};

export type StudentCourseDetail = StudentCourseSummary & {
  sections: StudentSectionSummary[];
};
