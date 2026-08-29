import type {
  AccountActivationPurpose,
  EnrollmentStatus,
  PlatformRole,
  TenantMembershipRole,
  TenantStudentStatus,
} from '../../../../.generated/prisma/client';

export type ActivationTokenResult = {
  id: string;
  rawToken: string;
  expiresAt: Date;
  purpose: AccountActivationPurpose;
};

export type InstructorSummary = {
  userId: string;
  email: string;
  displayName: string | null;
  accountStatus: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  membershipRole: TenantMembershipRole;
  createdAt: Date;
};

export type CreatedInstructorResult = InstructorSummary & {
  activation: ActivationTokenResult;
};

export type TenantContextSummary = {
  tenantId: string;
  name: string;
  slug: string;
  status: string;
  membershipRole: TenantMembershipRole;
};

export type TenantStudentSummary = {
  associationId: string;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string | null;
  accountStatus: string;
  status: TenantStudentStatus;
  activatedAt: Date | null;
  createdAt: Date;
};

export type AddTenantStudentResult = TenantStudentSummary & {
  activation: ActivationTokenResult | null;
};

export type EnrollmentSummary = {
  enrollmentId: string;
  tenantId: string;
  courseId: string;
  courseTitle: string;
  courseStatus: string;
  studentUserId: string;
  status: EnrollmentStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

export type StudentEnrollmentSummary = Omit<EnrollmentSummary, 'studentUserId'>;

export type PrincipalRole = PlatformRole;
