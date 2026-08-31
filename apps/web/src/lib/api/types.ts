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
