export type PlatformRole = "STUDENT" | "INSTRUCTOR" | "PLATFORM_ADMIN";
export type LanguagePreference = "EN" | "AR";
export type TenantMembershipRole = "OWNER" | "STAFF";

export type BackendErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

export type LoginResponse = {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  user: {
    id: string;
    role: PlatformRole;
  };
};

export type CurrentUser = {
  userId: string;
  role: PlatformRole;
  email: string;
  displayName: string | null;
  preferredLanguage: LanguagePreference;
};

export type TenantContext = {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
  membershipRole: TenantMembershipRole;
};

export type TenantListResponse = {
  items: TenantContext[];
};

/**
 * The shape every paginated instructor list endpoint returns. There is no
 * `total`/`count` field anywhere in the frozen v1 API - only a page of
 * `items` plus `hasMore`. Frontend code must never treat `items.length` or
 * a page size as a total record count.
 */
export type OffsetPage<T> = {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type CourseVisibility = "PRIVATE" | "ENROLLED_ONLY";

export type CourseSummary = {
  courseId: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
  status: CourseStatus;
  visibility: CourseVisibility;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Body for POST /instructor/tenants/:tenantId/courses. `status` is always server-derived (DRAFT) - never client-supplied. */
export type CreateCourseRequest = {
  title: string;
  description?: string;
  thumbnailAssetRef?: string;
  visibility?: CourseVisibility;
};

/** Body for PATCH /instructor/tenants/:tenantId/courses/:courseId. Metadata only - lifecycle status changes go through the dedicated publish/archive endpoints. */
export type UpdateCourseRequest = {
  title?: string;
  description?: string | null;
  thumbnailAssetRef?: string | null;
  visibility?: CourseVisibility;
};

export type SectionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type CourseSectionSummary = {
  sectionId: string;
  tenantId: string;
  courseId: string;
  title: string;
  description: string | null;
  /**
   * Server-authoritative order within the course. Not necessarily contiguous:
   * `(courseId, position)` is a plain unique index that also constrains ARCHIVED
   * rows, so an archived section permanently retains its old position value even
   * though it's excluded from reorder. The frontend must never display this raw
   * number as a rank - only the list's own (backend-sorted) row order matters.
   */
  position: number;
  status: SectionStatus;
  createdAt: string;
  updatedAt: string;
};

/** Response for GET /instructor/tenants/:tenantId/courses/:courseId/sections and the reorder endpoint. Unpaginated - the frozen API returns every section for a course in one response, including ARCHIVED ones. */
export type SectionListResponse = {
  items: CourseSectionSummary[];
};

/** Body for POST /instructor/tenants/:tenantId/courses/:courseId/sections. `position` is always server-computed - never client-supplied. */
export type CreateSectionRequest = {
  title: string;
  description?: string;
};

/** Body for PATCH .../sections/:sectionId. Metadata only - lifecycle status changes go through the dedicated publish/archive endpoints. */
export type UpdateSectionRequest = {
  title?: string;
  description?: string | null;
};

/**
 * Body for POST .../sections/reorder. Must contain exactly the current set of
 * non-ARCHIVED section IDs for the course, in the desired final order - not a
 * single section + target position, and never including archived section IDs
 * (the backend rejects a mismatched set with INVALID_SECTION_REORDER).
 */
export type ReorderSectionsRequest = {
  sectionIds: string[];
};

export type LessonType = "VIDEO" | "DOCUMENT" | "QUIZ";
export type LessonStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type LessonSummary = {
  lessonId: string;
  tenantId: string;
  courseId: string;
  sectionId: string;
  title: string;
  description: string | null;
  type: LessonType;
  /** Server-authoritative order within the section - see CourseSectionSummary.position for the same gap/retention caveat. */
  position: number;
  status: LessonStatus;
  availableFrom: string | null;
  availableUntil: string | null;
  createdAt: string;
  updatedAt: string;
  /** Exactly one of these three is non-null, matching `type`. Never editable after creation - only set at POST time. */
  videoAssetId: string | null;
  documentAssetId: string | null;
  quizId: string | null;
};

/** Response for GET .../sections/:sectionId/lessons and the reorder endpoint. Unpaginated - every lesson in the section in one response, including ARCHIVED ones. */
export type LessonListResponse = {
  items: LessonSummary[];
};

/**
 * Body for POST .../sections/:sectionId/lessons. The frozen backend has no
 * "create a lesson shell, bind content later" workflow: exactly one of
 * `videoAssetId`/`documentAssetId`/`quizId` must be supplied and must match
 * `type`, referencing an already-existing tenant asset/quiz. `position` is
 * always server-computed - never client-supplied.
 */
export type CreateLessonRequest = {
  title: string;
  description?: string;
  type: LessonType;
  videoAssetId?: string;
  documentAssetId?: string;
  quizId?: string;
  availableFrom?: string;
  availableUntil?: string;
};

/** Body for PATCH .../lessons/:lessonId. Metadata + availability only - `type` and the content reference are immutable after creation. */
export type UpdateLessonRequest = {
  title?: string;
  description?: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
};

/** Body for POST .../sections/:sectionId/lessons/reorder. Scoped to one section - must contain exactly that section's current non-ARCHIVED lesson IDs, in desired order. */
export type ReorderLessonsRequest = {
  lessonIds: string[];
};

export type AssetProcessingStatus = "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "ARCHIVED";

/**
 * GET /instructor/tenants/:tenantId/media/videos - the same real,
 * tenant-scoped asset list the Lesson content picker uses (see
 * lessons-service.ts). No `title`/filename field exists on this response -
 * the backend never returns one, so Media Management shows only these real
 * fields (status/duration/dates), never an invented display name.
 */
export type VideoAssetSummary = {
  videoAssetId: string;
  tenantId: string;
  uploadedByUserId: string;
  processingStatus: AssetProcessingStatus;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
};

/** GET /instructor/tenants/:tenantId/media/documents - the same real, tenant-scoped asset list the Lesson content picker uses (see lessons-service.ts). */
export type DocumentAssetSummary = {
  documentAssetId: string;
  tenantId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  processingStatus: AssetProcessingStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * Body for POST /instructor/tenants/:tenantId/media/documents/upload-intents.
 * `fileSizeBytes` must be the exact byte length of the file that will be
 * PUT to the returned `uploadUrl` - confirmation later verifies R2's actual
 * object size against this declared value.
 */
export type CreateDocumentUploadIntentRequest = {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
};

/**
 * Response for the same endpoint - a short-lived, single-object-scoped
 * Cloudflare R2 presigned `PUT` capability. `uploadUrl`/`headers` are
 * bearer material: never logged, never persisted beyond the active upload.
 * No R2 access key/secret is ever present here - only a capability the
 * backend already signed.
 */
export type DocumentUploadIntent = {
  documentAssetId: string;
  uploadUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
};

/** Response for POST /instructor/tenants/:tenantId/media/documents/:documentAssetId/confirm-upload (no request body). */
export type DocumentUploadConfirmation = {
  documentAssetId: string;
  processingStatus: AssetProcessingStatus;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  verifiedAt: string | null;
};

/** Body for POST /instructor/tenants/:tenantId/media/videos/upload-intents. The backend creates the real Bunny Stream video resource from this title - no other identity/config is client-supplied. */
export type CreateVideoUploadIntentRequest = {
  title: string;
};

/**
 * Response for the same endpoint - a short-lived Bunny Stream TUS upload
 * capability. `headers` carry only what Bunny's TUS protocol requires to
 * authorize this one upload (`AuthorizationSignature`, `AuthorizationExpire`,
 * `VideoId`, `LibraryId`) - never Bunny's API key or webhook signing
 * secret, which stay backend-only. `provider.bunnyStream` is exposed only
 * because Bunny's TUS contract requires the library/video identifiers as
 * upload metadata, not because it's a secret.
 */
export type VideoUploadIntent = {
  videoAssetId: string;
  tusEndpoint: string;
  expiresAt: string;
  headers: Record<string, string>;
  provider: {
    bunnyStream: {
      libraryId: string;
      videoId: string;
    };
  };
};

export type QuizStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type QuizRevealAnswersPolicy = "NEVER" | "AFTER_SUBMISSION" | "AFTER_PASSING";

/** GET /instructor/tenants/:tenantId/quizzes and GET /instructor/tenants/:tenantId/quizzes/:quizId. */
export type QuizSummary = {
  quizId: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: QuizStatus;
  passingScorePercent: string | null;
  attemptLimit: number | null;
  revealAnswersPolicy: QuizRevealAnswersPolicy;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Body for POST /instructor/tenants/:tenantId/quizzes. `status` is always server-derived (DRAFT). */
export type CreateQuizRequest = {
  title: string;
  description?: string | null;
  passingScorePercent?: number | null;
  attemptLimit?: number | null;
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
};

/** Body for PATCH /instructor/tenants/:tenantId/quizzes/:quizId. Metadata only; lifecycle uses publish/archive endpoints. */
export type UpdateQuizRequest = {
  title?: string;
  description?: string | null;
  passingScorePercent?: number | null;
  attemptLimit?: number | null;
  revealAnswersPolicy?: QuizRevealAnswersPolicy;
};

export type QuestionType = "MULTIPLE_CHOICE" | "TRUE_FALSE";
export type QuestionStatus = "ACTIVE" | "ARCHIVED";

export type QuestionSummary = {
  questionId: string;
  quizId: string;
  type: QuestionType;
  prompt: string;
  position: number;
  points: string;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
};

export type QuestionListResponse = {
  items: QuestionSummary[];
};

/** Body for POST /instructor/tenants/:tenantId/quizzes/:quizId/questions. `position` is server-computed. */
export type CreateQuestionRequest = {
  type: QuestionType;
  prompt: string;
  points: number;
};

/** Body for PATCH .../questions/:questionId. Supported metadata only. */
export type UpdateQuestionRequest = {
  prompt?: string;
  points?: number;
};

/** Body for POST .../questions/reorder. Must contain exactly the current active question IDs in final order. */
export type ReorderQuestionsRequest = {
  questionIds: string[];
};

export type QuestionOptionSummary = {
  optionId: string;
  questionId: string;
  label: string | null;
  text: string;
  position: number;
  isCorrect: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QuestionOptionListResponse = {
  items: QuestionOptionSummary[];
};

/** Body for POST .../questions/:questionId/options. `position` is server-computed. */
export type CreateQuestionOptionRequest = {
  label?: string | null;
  text: string;
  isCorrect?: boolean;
};

/**
 * Body for PATCH .../options/:optionId. `isCorrect: true` is the frozen
 * one-request radio-selection operation: the backend atomically clears sibling
 * correctness and makes this option the sole correct answer for the question.
 */
export type UpdateQuestionOptionRequest = {
  label?: string | null;
  text?: string;
  isCorrect?: boolean;
};

/** Body for POST .../options/reorder. Must contain exactly every current option ID for the question in final order. */
export type ReorderQuestionOptionsRequest = {
  optionIds: string[];
};

export type TenantStudentStatus = "ACTIVE" | "INACTIVE" | "REMOVED";

export type TenantStudentSummary = {
  associationId: string;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string | null;
  accountStatus: string;
  status: TenantStudentStatus;
  activatedAt: string | null;
  createdAt: string;
};

export type NotificationsUnreadCount = {
  unreadCount: number;
};

export type NotificationCategory = "SYSTEM" | "COURSE" | "SECURITY" | "ADMIN";

/**
 * Row shape for GET /instructor/notifications and the response of PATCH
 * /instructor/notifications/:notificationId/read (Slice H, frozen
 * `NotificationSummary` - see notification.types.ts). `type` is a free-form
 * backend identifier (e.g. `COURSE_ENROLLMENT_CREATED`) - never rendered
 * directly as UI copy; `category` is the closed, safe-to-map enum used for
 * the product-facing type indicator instead. `read`/`readAt` are backend
 * truth: `read` is exactly `readAt !== null`, and `readAt` is the real
 * first-read timestamp, set once and preserved by the frozen mark-read
 * endpoint's idempotent `WHERE readAt IS NULL` update - the frontend must
 * never invent or locally overwrite either field.
 */
export type NotificationSummary = {
  notificationId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  domainEntityType: string | null;
  domainEntityId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

/** Body for POST /instructor/tenants/:tenantId/students. */
export type AddStudentRequest = {
  email: string;
  displayName?: string;
};

export type AccountActivationPurpose = "INSTRUCTOR_ACTIVATION" | "STUDENT_ACTIVATION";

export type ActivationTokenResult = {
  id: string;
  rawToken: string;
  expiresAt: string;
  purpose: AccountActivationPurpose;
};

/**
 * Response for POST /instructor/tenants/:tenantId/students. `activation` is
 * only non-null when the backend had to create a brand-new account (no
 * existing password credential) - re-adding an already-associated student is
 * idempotent and returns `activation: null`. The frontend must never log or
 * render `rawToken`: it is a credential-equivalent secret, and no product
 * decision has been made yet about a secure delivery channel for it (see the
 * Slice C implementation report).
 */
export type AddTenantStudentResult = TenantStudentSummary & {
  activation: ActivationTokenResult | null;
};

export type EnrollmentStatus = "ACTIVE" | "INACTIVE" | "REVOKED" | "EXPIRED";

export type StudentContactSummary = {
  studentUserId: string;
  email: string;
  displayName: string | null;
  accountStatus: string;
};

export type EnrollmentSummary = {
  enrollmentId: string;
  tenantId: string;
  courseId: string;
  courseTitle: string;
  courseStatus: string;
  studentUserId: string;
  status: EnrollmentStatus;
  startsAt: string | null;
  endsAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Row shape for GET /instructor/tenants/:tenantId/enrollments (list only - not the create/revoke response). */
export type InstructorEnrollmentSummary = EnrollmentSummary & {
  student: StudentContactSummary;
  currentlyEffective: boolean;
};

/** Body for POST /instructor/tenants/:tenantId/enrollments. Dates, if given, must be ISO-8601 strings. */
export type CreateEnrollmentRequest = {
  studentUserId: string;
  courseId: string;
  startsAt?: string;
  endsAt?: string;
};

/**
 * Row shape for GET /instructor/tenants/:tenantId/courses/:courseId/progress
 * (Slice G, frozen `CourseProgressRow` - see `course-progress.types.ts`).
 * `completedLessons`/`totalLessons` are derived read-time from the Course's
 * *currently* published/available Lessons (`StudentCourseAccessService`'s
 * exact predicate) - not a frozen historical Lesson count, so this
 * denominator can shift as Lessons publish/unpublish. `progressPercent` is
 * always a 0-100 number rounded server-side to 2 decimal places - never
 * recomputed on the frontend. `lastActivityAt` is the later of this
 * Enrollment's latest completed-lesson timestamp and latest quiz-attempt
 * `updatedAt`, or null when neither exists yet.
 */
export type CourseProgressRow = {
  enrollmentId: string;
  status: EnrollmentStatus;
  currentlyEffective: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  student: StudentContactSummary;
  completedLessons: number;
  totalLessons: number;
  progressPercent: number;
  lastActivityAt: string | null;
};

export type QuizAttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "GRADED" | "ABANDONED";

/**
 * Row shape for GET /instructor/tenants/:tenantId/quizzes/:quizId/attempts
 * (Slice G, frozen `InstructorQuizAttemptSummary` - see
 * `instructor-quiz-attempt.types.ts`). Every score/max/percentage/passed
 * value is the exact historical snapshot the backend persisted at that
 * attempt's own grading time - the frontend must never recompute `passed`
 * or `percentage` from a Quiz's *current* `passingScorePercent`.
 * `scorePoints`/`maxPoints`/`percentage` are Decimal-as-string (never
 * parsed/re-rounded for anything but presentation) and are `null` together
 * with `passed` until the attempt is graded (`status` is `IN_PROGRESS` or
 * `ABANDONED` without ever having been graded).
 */
export type InstructorQuizAttemptSummary = {
  attemptId: string;
  quizId: string;
  enrollmentId: string;
  student: StudentContactSummary;
  status: QuizAttemptStatus;
  attemptNumber: number;
  scorePoints: string | null;
  maxPoints: string | null;
  percentage: string | null;
  passed: boolean | null;
  startedAt: string;
  submittedAt: string | null;
};

export type DevicePlatform = "IOS" | "ANDROID";

/**
 * Row shape for GET /admin/device-change-requests (Platform Admin only; the
 * frozen backend always filters this list to `PENDING` requests - there is
 * no status field here and no endpoint to read already-resolved requests,
 * since a resolved request simply stops appearing). `studentUserId` and
 * `currentDeviceId` are raw identifiers - the frozen response has no
 * student email/displayName and no model/platform/OS for the *current*
 * device, only for the requested one. The frontend must never fabricate
 * richer identity/device detail than this - render the raw IDs as-is.
 */
export type DeviceChangeRequestSummary = {
  id: string;
  studentUserId: string;
  requestedAt: string;
  requestedPlatform: DevicePlatform | null;
  requestedDeviceModel: string | null;
  requestedOsVersion: string | null;
  requestedAppVersion: string | null;
  currentDeviceId: string | null;
};

/** Body for POST /admin/device-change-requests/:id/approve and .../reject. */
export type ReviewDeviceChangeRequest = {
  reviewNote?: string;
};
