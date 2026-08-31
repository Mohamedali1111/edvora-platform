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

export type CourseSummary = {
  courseId: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  description: string | null;
  thumbnailAssetRef: string | null;
  status: CourseStatus;
  visibility: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
