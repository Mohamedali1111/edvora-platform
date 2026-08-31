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

// Reuses exactly the fields already legitimately exposed to instructors via
// `TenantStudentSummary` (`GET /instructor/tenants/:tenantId/students/:studentUserId`) — never
// broadens instructor-facing student PII exposure beyond that existing boundary.
export type StudentContactSummary = {
  studentUserId: string;
  email: string;
  displayName: string | null;
  accountStatus: string;
};

export type InstructorEnrollmentSummary = EnrollmentSummary & {
  student: StudentContactSummary;
  // Derived, never persisted: the exact canonical Enrollment-row time predicate used for student
  // entitlement (`status === ACTIVE && (startsAt === null || startsAt <= now) && (endsAt === null
  // || endsAt > now)` — see `StudentCourseAccessService`'s `entitlementWhere`), computed at read
  // time. Deliberately narrower than full student entitlement: it does not also require the
  // Course to be `PUBLISHED` or the Tenant/TenantStudent to be `ACTIVE`, since an instructor
  // roster already has that context and re-joining it here was not needed to save the frontend
  // from re-implementing this one specific date-window computation.
  currentlyEffective: boolean;
};

export type PrincipalRole = PlatformRole;
