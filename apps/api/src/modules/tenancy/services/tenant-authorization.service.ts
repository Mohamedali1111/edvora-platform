import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  PlatformRole,
  TenantMembershipStatus,
  TenantStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import {
  InstructorRequiredError,
  PlatformAdminRequiredError,
  StudentRequiredError,
  TenantAccessDeniedError,
} from '../errors/tenancy.errors';

@Injectable()
export class TenantAuthorizationService {
  constructor(private readonly prismaService: PrismaService) {}

  async assertActivePlatformAdmin(
    principal: AuthenticatedPrincipal,
    client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client,
  ): Promise<void> {
    const user = await client.user.findUnique({
      where: { id: principal.userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (
      !user ||
      user.platformRole !== PlatformRole.PLATFORM_ADMIN ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new PlatformAdminRequiredError();
    }
  }

  async assertActiveInstructor(
    principal: AuthenticatedPrincipal,
    client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client,
  ): Promise<void> {
    const user = await client.user.findUnique({
      where: { id: principal.userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (
      !user ||
      user.platformRole !== PlatformRole.INSTRUCTOR ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new InstructorRequiredError();
    }
  }

  async assertActiveStudent(
    principal: AuthenticatedPrincipal,
    client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client,
  ): Promise<void> {
    const user = await client.user.findUnique({
      where: { id: principal.userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (
      !user ||
      user.platformRole !== PlatformRole.STUDENT ||
      user.accountStatus !== AccountStatus.ACTIVE
    ) {
      throw new StudentRequiredError();
    }
  }

  async assertInstructorTenantAccess(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    client: PrismaService['client'] | PrismaTransactionClient = this.prismaService.client,
  ) {
    await this.assertActiveInstructor(principal, client);

    const membership = await client.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: principal.userId,
        },
      },
      include: { tenant: true },
    });

    if (
      !membership ||
      membership.status !== TenantMembershipStatus.ACTIVE ||
      membership.tenant.status !== TenantStatus.ACTIVE
    ) {
      throw new TenantAccessDeniedError();
    }

    return membership;
  }
}
