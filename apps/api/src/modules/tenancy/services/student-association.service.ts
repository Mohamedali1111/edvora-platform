import { Injectable } from '@nestjs/common';
import {
  AccountActivationPurpose,
  AccountStatus,
  CredentialType,
  PlatformRole,
  SecurityEventCategory,
  TenantStudentStatus,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { normalizeEmailForLookup } from '../../auth/email-normalization';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { AccountActivationTokenService } from '../../auth/services/account-activation-token.service';
import { ClockService } from '../../auth/services/clock.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import {
  IdentityRoleConflictError,
  TenantStudentNotFoundError,
} from '../errors/tenancy.errors';
import type { AddTenantStudentResult, TenantStudentSummary } from '../types/tenancy.types';
import { isPrismaUniqueViolation } from './prisma-error.util';
import { TenantAuthorizationService } from './tenant-authorization.service';

export type AddStudentInput = {
  principal: AuthenticatedPrincipal;
  tenantId: string;
  email: string;
  displayName?: string;
};

@Injectable()
export class StudentAssociationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly activationTokens: AccountActivationTokenService,
    private readonly securityEvents: SecurityEventService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  async addStudent(input: AddStudentInput): Promise<AddTenantStudentResult> {
    return this.addStudentAttempt(input, true);
  }

  async listStudents(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<TenantStudentSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const rows = await this.prismaService.client.tenantStudent.findMany({
      where: { tenantId },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { student: true },
    });

    return rows.map(toTenantStudentSummary);
  }

  async getStudent(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    studentUserId: string,
  ): Promise<TenantStudentSummary> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const row = await this.prismaService.client.tenantStudent.findUnique({
      where: { tenantId_studentUserId: { tenantId, studentUserId } },
      include: { student: true },
    });

    if (!row) {
      throw new TenantStudentNotFoundError();
    }

    return toTenantStudentSummary(row);
  }

  private async addStudentAttempt(
    input: AddStudentInput,
    allowRetry: boolean,
  ): Promise<AddTenantStudentResult> {
    const normalizedEmail = normalizeEmailForLookup(input.email);
    const email = input.email.trim();
    const displayName = input.displayName?.trim() || null;

    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.authorization.assertInstructorTenantAccess(input.principal, input.tenantId, tx);

        const now = this.clock.now();
        const user = await tx.user.upsert({
          where: { normalizedEmail },
          update: {},
          create: {
            id: this.uuid.create(),
            email,
            normalizedEmail,
            displayName,
            platformRole: PlatformRole.STUDENT,
            accountStatus: AccountStatus.ACTIVE,
            createdAt: now,
            studentProfile: {
              create: {
                id: this.uuid.create(),
                createdAt: now,
              },
            },
          },
          include: {
            studentProfile: true,
            authCredentials: {
              where: { credentialType: CredentialType.PASSWORD },
              take: 1,
            },
          },
        });

        if (user.platformRole !== PlatformRole.STUDENT) {
          throw new IdentityRoleConflictError();
        }

        if (!user.studentProfile) {
          await tx.studentProfile.create({
            data: {
              id: this.uuid.create(),
              userId: user.id,
              createdAt: now,
            },
          });
        }

        const existingAssociation = await tx.tenantStudent.findUnique({
          where: {
            tenantId_studentUserId: {
              tenantId: input.tenantId,
              studentUserId: user.id,
            },
          },
          include: { student: true },
        });

        const association = existingAssociation
          ? await tx.tenantStudent.update({
              where: { id: existingAssociation.id },
              data: {
                status: TenantStudentStatus.ACTIVE,
                removedAt: null,
                activatedAt: existingAssociation.activatedAt ?? now,
              },
              include: { student: true },
            })
          : await tx.tenantStudent.create({
              data: {
                id: this.uuid.create(),
                tenantId: input.tenantId,
                studentUserId: user.id,
                status: TenantStudentStatus.ACTIVE,
                createdByUserId: input.principal.userId,
                activatedAt: now,
                createdAt: now,
              },
              include: { student: true },
            });

        const shouldIssueActivation = user.authCredentials.length === 0;
        const activation = shouldIssueActivation
          ? await this.activationTokens.issueWithinTransaction(tx, {
              userId: user.id,
              purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
              tenantId: input.tenantId,
              initiatedByUserId: input.principal.userId,
            })
          : null;

        await this.securityEvents.recordWithinTransaction(tx, {
          eventType: 'STUDENT_ASSOCIATED_WITH_TENANT',
          category: SecurityEventCategory.ADMIN,
          actorUserId: input.principal.userId,
          targetUserId: user.id,
          tenantId: input.tenantId,
          metadata: {
            tenantStudentId: association.id,
            reactivated: Boolean(existingAssociation && existingAssociation.status !== TenantStudentStatus.ACTIVE),
            activationIssued: Boolean(activation),
          },
        });

        return {
          ...toTenantStudentSummary(association),
          activation: activation
            ? {
                id: activation.id,
                rawToken: activation.rawToken,
                expiresAt: activation.expiresAt,
                purpose: AccountActivationPurpose.STUDENT_ACTIVATION,
              }
            : null,
        };
      });
    } catch (error) {
      if (allowRetry && isPrismaUniqueViolation(error)) {
        const existing = await this.prismaService.client.user.findUnique({
          where: { normalizedEmail },
          select: { id: true },
        });

        if (existing) {
          return this.addStudentAttempt(input, false);
        }
      }

      throw error;
    }
  }
}

function toTenantStudentSummary(row: {
  id: string;
  tenantId: string;
  studentUserId: string;
  status: TenantStudentStatus;
  activatedAt: Date | null;
  createdAt: Date;
  student: {
    id: string;
    email: string;
    displayName: string | null;
    accountStatus: AccountStatus;
  };
}): TenantStudentSummary {
  return {
    associationId: row.id,
    tenantId: row.tenantId,
    userId: row.studentUserId,
    email: row.student.email,
    displayName: row.student.displayName,
    accountStatus: row.student.accountStatus,
    status: row.status,
    activatedAt: row.activatedAt,
    createdAt: row.createdAt,
  };
}
