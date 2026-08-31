import { Injectable } from '@nestjs/common';
import {
  AccountActivationPurpose,
  AccountStatus,
  PlatformRole,
  SecurityEventCategory,
  TenantMembershipRole,
  TenantMembershipStatus,
  TenantStatus,
} from '../../../../.generated/prisma/client';
import { normalizeEmailForLookup } from '../../auth/email-normalization';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { AccountActivationTokenService } from '../../auth/services/account-activation-token.service';
import { ClockService } from '../../auth/services/clock.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import {
  IdentityRoleConflictError,
  InstructorAlreadyExistsError,
  InstructorNotFoundError,
  TenantSlugAlreadyExistsError,
} from '../errors/tenancy.errors';
import type { CreatedInstructorResult, InstructorSummary } from '../types/tenancy.types';
import { isPrismaUniqueViolation } from './prisma-error.util';
import { TenantAuthorizationService } from './tenant-authorization.service';

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
          },
        },
      },
    });
    const { items: pageRows, hasMore } = trimToOffsetPage(rows, limit);

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
    };
  }
}
