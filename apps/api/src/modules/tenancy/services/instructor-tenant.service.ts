import { Injectable } from '@nestjs/common';
import { TenantMembershipStatus } from '../../../../.generated/prisma/client';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { TenantContextSummary } from '../types/tenancy.types';
import { TenantAuthorizationService } from './tenant-authorization.service';

@Injectable()
export class InstructorTenantService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
  ) {}

  async listInstructorTenants(principal: AuthenticatedPrincipal): Promise<TenantContextSummary[]> {
    await this.authorization.assertActiveInstructor(principal);

    const memberships = await this.prismaService.client.tenantMembership.findMany({
      where: {
        userId: principal.userId,
        status: TenantMembershipStatus.ACTIVE,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { tenant: true },
    });

    return memberships.map((membership) => ({
      tenantId: membership.tenant.id,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      status: membership.tenant.status,
      membershipRole: membership.role,
    }));
  }

  async getTenantContext(
    principal: AuthenticatedPrincipal,
    tenantId: string,
  ): Promise<TenantContextSummary> {
    const membership = await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    return {
      tenantId: membership.tenant.id,
      name: membership.tenant.name,
      slug: membership.tenant.slug,
      status: membership.tenant.status,
      membershipRole: membership.role,
    };
  }
}
