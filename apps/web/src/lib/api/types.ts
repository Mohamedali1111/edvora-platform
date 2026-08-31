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
