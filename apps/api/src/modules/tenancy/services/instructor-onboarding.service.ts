import { Injectable } from '@nestjs/common';
import {
  AccountActivationPurpose,
  AccountStatus,
  CredentialType,
  PlatformRole,
  SecurityEventCategory,
  TenantMembershipRole,
  TenantMembershipStatus,
  TenantStatus,
} from '../../../../.generated/prisma/client';
import { normalizeEmailForLookup } from '../../auth/email-normalization';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import {
  ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE,
  AccountActivationTokenService,
} from '../../auth/services/account-activation-token.service';
import { ClockService } from '../../auth/services/clock.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import {
  IdentityRoleConflictError,
  InstructorAlreadyActivatedError,
  InstructorAlreadyExistsError,
  InstructorNotFoundError,
  TenantSlugAlreadyExistsError,
} from '../errors/tenancy.errors';
import type {
  ActivationTokenResult,
  CreatedInstructorResult,
  InstructorActivationState,
  InstructorSummary,
} from '../types/tenancy.types';
import { isPrismaUniqueViolation } from './prisma-error.util';
import { TenantAuthorizationService } from './tenant-authorization.service';

// The one Instructor-onboarding-scoped fields every list/detail/reissue read needs to derive
// `InstructorActivationState` — added on top of the pre-existing `tenantMemberships` include
// each caller already had, never a schema change. `authCredentials` proves ACTIVATED (the exact
// same PASSWORD-credential-existence fact `AuthOrchestrationService.activateAccount` establishes
// on completion); `accountActivationTokens` (newest first, one row) reports whether the most
// recently issued `INSTRUCTOR_ACTIVATION` token is still usable. Both relations are already
// indexed for lookups scoped by `userId` (`auth_credentials_user_id_credential_type_key`,
// `account_activation_tokens_outstanding_lookup_idx`), so this needs no new index or migration.
const INSTRUCTOR_ACTIVATION_STATE_INCLUDE = {
  authCredentials: {
    where: { credentialType: CredentialType.PASSWORD },
    take: 1,
    select: { id: true },
  },
  accountActivationTokens: {
    where: { purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { expiresAt: true, consumedAt: true, revokedAt: true },
  },
};

type InstructorActivationStateUser = {
  authCredentials: { id: string }[];
  accountActivationTokens: { expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null }[];
};

export type CreateInstructorInput = {
  principal: AuthenticatedPrincipal;
  email: string;
  displayName?: string;
  tenantName: string;
  tenantSlug: string;
};

@Injectable()
export class InstructorOnboardingService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly activationTokens: AccountActivationTokenService,
    private readonly securityEvents: SecurityEventService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  async createInstructor(input: CreateInstructorInput): Promise<CreatedInstructorResult> {
    const normalizedEmail = normalizeEmailForLookup(input.email);
    const email = input.email.trim();
    const tenantSlug = input.tenantSlug.trim().toLowerCase();
    const displayName = input.displayName?.trim() || null;

    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertActivePlatformAdmin(input.principal, tx);

        const existingUser = await tx.user.findUnique({
          where: { normalizedEmail },
          include: { instructorProfile: true },
        });

        if (existingUser) {
          if (existingUser.platformRole !== PlatformRole.INSTRUCTOR) {
            throw new IdentityRoleConflictError();
          }

          throw new InstructorAlreadyExistsError();
        }

        const existingTenant = await tx.tenant.findUnique({ where: { slug: tenantSlug } });
        if (existingTenant) {
          throw new TenantSlugAlreadyExistsError();
        }

        const now = this.clock.now();
        const user = await tx.user.create({
          data: {
            id: this.uuid.create(),
            email,
            normalizedEmail,
            displayName,
            platformRole: PlatformRole.INSTRUCTOR,
            accountStatus: AccountStatus.ACTIVE,
            createdAt: now,
          },
        });

        await tx.instructorProfile.create({
          data: {
            id: this.uuid.create(),
            userId: user.id,
            createdAt: now,
          },
        });

        const tenant = await tx.tenant.create({
          data: {
            id: this.uuid.create(),
            name: input.tenantName.trim(),
            slug: tenantSlug,
            status: TenantStatus.ACTIVE,
            createdAt: now,
          },
        });

        const membership = await tx.tenantMembership.create({
          data: {
            id: this.uuid.create(),
            tenantId: tenant.id,
            userId: user.id,
            role: TenantMembershipRole.OWNER,
            status: TenantMembershipStatus.ACTIVE,
            createdAt: now,
          },
        });

        const activation = await this.activationTokens.issueWithinTransaction(tx, {
          userId: user.id,
          purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
          tenantId: tenant.id,
          initiatedByUserId: input.principal.userId,
        });

        await this.securityEvents.recordWithinTransaction(tx, {
          eventType: 'INSTRUCTOR_CREATED',
          category: SecurityEventCategory.ADMIN,
          actorUserId: input.principal.userId,
          targetUserId: user.id,
          tenantId: tenant.id,
          metadata: {
            tenantId: tenant.id,
            membershipId: membership.id,
          },
        });

        await this.securityEvents.recordWithinTransaction(tx, {
          eventType: 'TENANT_CREATED',
          category: SecurityEventCategory.ADMIN,
          actorUserId: input.principal.userId,
          targetUserId: user.id,
          tenantId: tenant.id,
          metadata: {
            tenantId: tenant.id,
            ownerUserId: user.id,
          },
        });

        return {
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          accountStatus: user.accountStatus,
          tenantId: tenant.id,
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          membershipRole: membership.role,
          createdAt: user.createdAt,
          // Freshly created, in the same transaction as the activation token this response
          // hands back — always PENDING_ACTIVATION with that token's own expiry, never derived
          // from a second read.
          activationState: 'PENDING_ACTIVATION',
          activationExpiresAt: activation.expiresAt,
          activation: {
            id: activation.id,
            rawToken: activation.rawToken,
            expiresAt: activation.expiresAt,
            purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
          },
        };
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        const [emailOwner, tenantOwner] = await Promise.all([
          this.prismaService.client.user.findUnique({
            where: { normalizedEmail },
            select: { id: true },
          }),
          this.prismaService.client.tenant.findUnique({
            where: { slug: tenantSlug },
            select: { id: true },
          }),
        ]);

        if (emailOwner) {
          throw new InstructorAlreadyExistsError();
        }

        if (tenantOwner) {
          throw new TenantSlugAlreadyExistsError();
        }
      }

      throw error;
    }
  }

  async listInstructors(
    principal: AuthenticatedPrincipal,
    limit: number,
    offset: number,
  ): Promise<{ items: InstructorSummary[]; hasMore: boolean }> {
    await this.authorization.assertActivePlatformAdmin(principal);

    // Eligibility is enforced in the query itself, not after fetching: only an `InstructorProfile`
    // whose `User` has an applicable OWNER `TenantMembership` can ever become a returned item, so
    // `take`/`skip` here operate on the exact same ordered set `items` is built from — `take: limit
    // + 1` fetches one row past the page, and the `where` guarantees every one of those rows,
    // sentinel included, is a genuine candidate.
    //
    // `createInstructor` above always creates the `InstructorProfile`, `Tenant`, and its OWNER
    // `TenantMembership` together in one transaction, and no code anywhere in this codebase ever
    // updates or deletes a `TenantMembership` afterward — so an `InstructorProfile` with no OWNER
    // membership cannot occur through any reachable production code path today; the prior version
    // of this method's post-fetch drop was purely defensive against a data anomaly that has never
    // actually been possible to produce. It was still a real pagination bug: fetching an unfiltered
    // page and dropping ineligible rows afterward in application code (`flatMap`) let `hasMore` and
    // `items.length` reflect a broader candidate set than the actual result set, could hide a real
    // next page, and could make `offset` skip past genuinely eligible instructors sitting behind an
    // ineligible row — all reachable the moment such a row ever existed, however it got there (a
    // manual data fix, a future admin action, direct DB access). Pushing the condition into `where`
    // closes all three regardless of how or whether that data state can arise.
    const rows = await this.prismaService.client.instructorProfile.findMany({
      where: {
        user: {
          tenantMemberships: { some: { role: TenantMembershipRole.OWNER } },
        },
      },
      take: limit + 1,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: {
        user: {
          include: {
            tenantMemberships: {
              where: { role: TenantMembershipRole.OWNER },
              include: { tenant: true },
              take: 1,
            },
            ...INSTRUCTOR_ACTIVATION_STATE_INCLUDE,
          },
        },
      },
    });
    const { items: pageRows, hasMore } = trimToOffsetPage(rows, limit);
    const now = this.clock.now();

    const items = pageRows.map((profile) => {
      // Guaranteed by the query's own `where` above — every row reaching this point has at least
      // one OWNER `TenantMembership`, so `tenantMemberships[0]` can never be empty in practice.
      // Asserted explicitly (never silently dropped) so a genuine data/query inconsistency fails
      // loudly instead of silently shrinking the page — the exact defect this replaces.
      const membership = profile.user.tenantMemberships[0];
      if (!membership) {
        throw new Error(
          'InstructorProfile matched the OWNER-membership eligibility filter but returned no OWNER membership',
        );
      }

      return {
        userId: profile.user.id,
        email: profile.user.email,
        displayName: profile.user.displayName,
        accountStatus: profile.user.accountStatus,
        tenantId: membership.tenant.id,
        tenantName: membership.tenant.name,
        tenantSlug: membership.tenant.slug,
        membershipRole: membership.role,
        createdAt: profile.createdAt,
        ...deriveInstructorActivationState(profile.user, now),
      };
    });

    return { items, hasMore };
  }

  async getInstructorDetails(
    principal: AuthenticatedPrincipal,
    instructorId: string,
  ): Promise<InstructorSummary> {
    await this.authorization.assertActivePlatformAdmin(principal);

    const profile = await this.prismaService.client.instructorProfile.findUnique({
      where: { userId: instructorId },
      include: {
        user: {
          include: {
            tenantMemberships: {
              where: { role: TenantMembershipRole.OWNER },
              include: { tenant: true },
              take: 1,
            },
            ...INSTRUCTOR_ACTIVATION_STATE_INCLUDE,
          },
        },
      },
    });

    const membership = profile?.user.tenantMemberships[0];
    if (!profile || !membership) {
      throw new InstructorNotFoundError();
    }

    return {
      userId: profile.user.id,
      email: profile.user.email,
      displayName: profile.user.displayName,
      accountStatus: profile.user.accountStatus,
      tenantId: membership.tenant.id,
      tenantName: membership.tenant.name,
      tenantSlug: membership.tenant.slug,
      membershipRole: membership.role,
      createdAt: profile.createdAt,
      ...deriveInstructorActivationState(profile.user, this.clock.now()),
    };
  }

  /**
   * G-02 repair: the smallest additive contract letting a PLATFORM_ADMIN unblock an Instructor
   * whose original activation code was lost or has expired, by issuing a fresh one. Only ever
   * targets an Instructor with no PASSWORD `AuthCredential` yet — an already-activated account is
   * rejected deterministically and untouched (no password reset, no second credential, no change
   * to `accountStatus`). Delegates the actual issue-and-revoke-prior-token mechanics entirely to
   * `AccountActivationTokenService.issueWithinTransaction` (the exact same primitive
   * `createInstructor` already uses) — this method adds no parallel token logic of its own.
   */
  async reissueActivation(
    principal: AuthenticatedPrincipal,
    instructorId: string,
  ): Promise<ActivationTokenResult> {
    return this.prismaService.client.$transaction(async (tx) => {
      // The shared account-activation lock (see ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE's own
      // doc comment) - acquired first, before any read, exactly like
      // AccountActivationTokenService.consumeWithinTransaction acquires the very same lock for
      // the Instructor's own userId. Both sides participating is what actually closes the race:
      // this alone would only serialize reissue against itself (still necessary - two concurrent
      // reissues must never each issue an independently valid token) but would do nothing against
      // a concurrent activation, which is a completely different code path that would not be
      // waiting on this lock at all unless it also acquires it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${instructorId}, ${ACCOUNT_ACTIVATION_ADVISORY_LOCK_NAMESPACE}::bigint))`;

      await this.authorization.assertActivePlatformAdmin(principal, tx);

      const profile = await tx.instructorProfile.findUnique({
        where: { userId: instructorId },
        include: {
          user: {
            include: {
              tenantMemberships: { where: { role: TenantMembershipRole.OWNER }, take: 1 },
              authCredentials: {
                where: { credentialType: CredentialType.PASSWORD },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      });

      const membership = profile?.user.tenantMemberships[0];
      if (!profile || !membership) {
        throw new InstructorNotFoundError();
      }

      if (profile.user.authCredentials.length > 0) {
        throw new InstructorAlreadyActivatedError();
      }

      const activation = await this.activationTokens.issueWithinTransaction(tx, {
        userId: profile.user.id,
        purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
        tenantId: membership.tenantId,
        initiatedByUserId: principal.userId,
      });

      await this.securityEvents.recordWithinTransaction(tx, {
        eventType: 'INSTRUCTOR_ACTIVATION_REISSUED',
        category: SecurityEventCategory.ADMIN,
        actorUserId: principal.userId,
        targetUserId: profile.user.id,
        tenantId: membership.tenantId,
        metadata: { tenantId: membership.tenantId },
      });

      return {
        id: activation.id,
        rawToken: activation.rawToken,
        expiresAt: activation.expiresAt,
        purpose: AccountActivationPurpose.INSTRUCTOR_ACTIVATION,
      };
    });
  }
}

/**
 * Pure derivation, no I/O — `ACTIVATED` whenever a PASSWORD credential already exists;
 * otherwise `PENDING_ACTIVATION` if the most recently issued `INSTRUCTOR_ACTIVATION` token is
 * still unconsumed, unrevoked, and unexpired, else `ACTIVATION_EXPIRED`. The "no token was ever
 * issued" branch is unreachable through any current production path (`createInstructor` always
 * issues one in the same transaction that creates the Instructor) but is not treated as an error
 * here — it reads as `PENDING_ACTIVATION` with no known expiry, the same optimistic default an
 * Admin would want if that invariant were ever violated by a future code path or a manual data
 * fix, rather than surfacing an internal exception on a read-only list/detail request.
 */
function deriveInstructorActivationState(
  user: InstructorActivationStateUser,
  now: Date,
): { activationState: InstructorActivationState; activationExpiresAt: Date | null } {
  if (user.authCredentials.length > 0) {
    return { activationState: 'ACTIVATED', activationExpiresAt: null };
  }

  const latestToken = user.accountActivationTokens[0] ?? null;
  if (!latestToken) {
    return { activationState: 'PENDING_ACTIVATION', activationExpiresAt: null };
  }

  const stillValid = !latestToken.consumedAt && !latestToken.revokedAt && latestToken.expiresAt > now;

  if (stillValid) {
    return { activationState: 'PENDING_ACTIVATION', activationExpiresAt: latestToken.expiresAt };
  }

  return { activationState: 'ACTIVATION_EXPIRED', activationExpiresAt: null };
}
