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
