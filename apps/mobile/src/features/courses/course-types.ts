// Mirrors apps/api/src/modules/courses/types/student-course.types.ts exactly. These
// are the backend's deliberately student-safe shapes — no authoring fields
// (status, visibility, ownership), no provider/storage internals (asset ids,
// provider keys). Every field here is already proven safe to render.

export type LessonType = 'VIDEO' | 'DOCUMENT' | 'QUIZ';
export type LessonProgressStatus = 'NOT_STARTED' | 'STARTED' | 'COMPLETED';
export type AssetProcessingStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'ARCHIVED';
export type QuizStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

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
  // Decimal string on the wire (backend serializes a Prisma BigInt column this way).
  fileSizeBytes: string;
};

export type StudentQuizLessonMetadata = {
  title: string;
  status: QuizStatus;
};

// A missing progress row reads as NOT_STARTED with no completedAt — this app never
// creates a progress row merely by reading one (see StudentCourseAccessService).
export type StudentLessonProgress = {
  status: LessonProgressStatus;
  completedAt: string | null;
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
