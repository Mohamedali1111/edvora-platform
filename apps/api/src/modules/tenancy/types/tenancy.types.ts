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

/**
 * Derived, read-time-only Instructor onboarding state — never persisted as its own column.
 * `ACTIVATED` is authoritative from the existence of a PASSWORD `AuthCredential` (the exact same
 * fact `AuthOrchestrationService.activateAccount` itself creates when a Instructor completes
 * activation — see `InstructorOnboardingService`'s derivation). `PENDING_ACTIVATION` and
 * `ACTIVATION_EXPIRED` distinguish, for an Instructor with no credential yet, whether the most
 * recently issued `INSTRUCTOR_ACTIVATION` token is still usable or has passed its TTL — purely
 * informational for the Admin UI; both states are equally eligible for reissue.
 */
export type InstructorActivationState = 'PENDING_ACTIVATION' | 'ACTIVATED' | 'ACTIVATION_EXPIRED';

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
  activationState: InstructorActivationState;
  /** The currently outstanding activation token's expiry, only when `activationState` is `PENDING_ACTIVATION`; `null` otherwise. */
  activationExpiresAt: Date | null;
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
