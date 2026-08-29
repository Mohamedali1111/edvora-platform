import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  DeviceChangeRequestStatus,
  PlatformRole,
  Prisma,
  SecurityEventCategory,
  SecurityEventSeverity,
  StudentDeviceStatus,
  type StudentDevice,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { SecurityEventService } from '../../auth/services/security-event.service';
import { TokenCryptoService } from '../../auth/services/token-crypto.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import type { PrismaTransactionClient } from '../../auth/types/prisma-transaction.type';
import {
  DeviceAccountInactiveError,
  DeviceChangeAlreadyPendingError,
  DeviceChangeRequestAlreadyResolvedError,
  DeviceChangeRequestNotFoundError,
  DeviceInstallationIdInvalidError,
  DeviceInstallationIdRequiredError,
  DeviceNotAuthorizedError,
  PlatformAdminRequiredError,
  StudentRequiredError,
} from '../errors/device.errors';
import type {
  DeviceChangeRequestResult,
  DeviceChangeRequestSummary,
  DeviceMetadata,
  StudentDeviceAuthorizationResult,
} from '../types/device.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class StudentDeviceService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly uuid: UuidV7Service,
    private readonly securityEvents: SecurityEventService,
  ) {}

  async authorizeInitialStudentDevice(input: {
    principal: AuthenticatedPrincipal;
    installationId: string;
    metadata: DeviceMetadata;
  }): Promise<StudentDeviceAuthorizationResult> {
    this.assertStudentPrincipal(input.principal);
    const installationHash = this.hashInstallationId(input.installationId);

    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.assertActiveStudent(tx, input.principal.userId);
        await this.lockStudentDeviceState(tx, input.principal.userId);

        const existingSame = await this.findDeviceByHash(
          tx,
          input.principal.userId,
          installationHash,
        );

        if (existingSame?.status === StudentDeviceStatus.ACTIVE) {
          await this.touchDevice(tx, existingSame.id, input.metadata);
          return { status: 'AUTHORIZED', deviceId: existingSame.id };
        }

        const activeDevice = await this.findActiveDevice(tx, input.principal.userId);
        if (activeDevice) {
          await this.recordDeviceEvent(tx, {
            eventType: 'DEVICE_AUTHORIZATION_FAILED',
            actorUserId: input.principal.userId,
            targetUserId: input.principal.userId,
            deviceId: activeDevice.id,
            severity: SecurityEventSeverity.WARN,
            metadata: { reason: 'different_active_device_present' },
          });
          return { status: 'CHANGE_REQUIRED', deviceId: activeDevice.id, pendingRequest: false };
        }

        if (existingSame) {
          return { status: 'CHANGE_REQUIRED', deviceId: existingSame.id, pendingRequest: false };
        }

        const device = await tx.studentDevice.create({
          data: {
            id: this.uuid.create(),
            studentUserId: input.principal.userId,
            clientDeviceIdHash: installationHash,
            platform: input.metadata.platform,
            status: StudentDeviceStatus.ACTIVE,
            approvedAt: this.clock.now(),
            activatedAt: this.clock.now(),
            lastSeenAt: this.clock.now(),
            deviceModel: input.metadata.deviceModel,
            osVersion: input.metadata.osVersion,
            appVersion: input.metadata.appVersion,
          },
        });

        await this.recordDeviceEvent(tx, {
          eventType: 'STUDENT_DEVICE_APPROVED',
          actorUserId: input.principal.userId,
          targetUserId: input.principal.userId,
          deviceId: device.id,
          metadata: { approval_source: 'first_device' },
        });

        return { status: 'AUTHORIZED', deviceId: device.id };
      });
    } catch (error: unknown) {
      if (isExpectedDeviceUniquenessError(error)) {
        return this.checkStudentDeviceAuthorization({
          principal: input.principal,
          installationId: input.installationId,
        });
      }

      throw error;
    }
  }

  async checkStudentDeviceAuthorization(input: {
    principal: AuthenticatedPrincipal;
    installationId: string;
  }): Promise<StudentDeviceAuthorizationResult> {
    this.assertStudentPrincipal(input.principal);
    const installationHash = this.hashInstallationId(input.installationId);

    await this.assertActiveStudent(this.prismaService.client, input.principal.userId);

    const matchingDevice = await this.findDeviceByHash(
      this.prismaService.client,
      input.principal.userId,
      installationHash,
    );

    if (matchingDevice?.status === StudentDeviceStatus.ACTIVE) {
      await this.touchDevice(this.prismaService.client, matchingDevice.id);
      return { status: 'AUTHORIZED', deviceId: matchingDevice.id };
    }

    const pending = await this.prismaService.client.deviceChangeRequest.findFirst({
      where: {
        studentUserId: input.principal.userId,
        status: DeviceChangeRequestStatus.PENDING,
        requestedDevice: {
          clientDeviceIdHash: installationHash,
        },
      },
      select: { id: true },
    });

    if (pending) {
      return { status: 'CHANGE_PENDING', requestId: pending.id, pendingRequest: true };
    }

    const activeDevice = await this.findActiveDevice(this.prismaService.client, input.principal.userId);
    return activeDevice
      ? { status: 'CHANGE_REQUIRED', deviceId: activeDevice.id, pendingRequest: false }
      : { status: 'NO_DEVICE_REGISTERED', pendingRequest: false };
  }

  async requestDeviceChange(input: {
    principal: AuthenticatedPrincipal;
    installationId: string;
    metadata: DeviceMetadata;
    reason?: string;
  }): Promise<DeviceChangeRequestResult> {
    this.assertStudentPrincipal(input.principal);
    const installationHash = this.hashInstallationId(input.installationId);

    try {
      return await this.prismaService.client.$transaction(async (tx) => {
        await this.assertActiveStudent(tx, input.principal.userId);
        await this.lockStudentDeviceState(tx, input.principal.userId);

        const sameDevice = await this.findDeviceByHash(tx, input.principal.userId, installationHash);
        if (sameDevice?.status === StudentDeviceStatus.ACTIVE) {
          await this.touchDevice(tx, sameDevice.id, input.metadata);
          return { status: 'AUTHORIZED', deviceId: sameDevice.id };
        }

        const activeDevice = await this.findActiveDevice(tx, input.principal.userId);
        if (!activeDevice) {
          const authorized = await this.authorizeFirstDeviceWithinTransaction(
            tx,
            input.principal.userId,
            installationHash,
            input.metadata,
          );
          return { status: 'AUTHORIZED', deviceId: authorized.id };
        }

        const existingPending = await tx.deviceChangeRequest.findFirst({
          where: {
            studentUserId: input.principal.userId,
            status: DeviceChangeRequestStatus.PENDING,
          },
          include: { requestedDevice: true },
        });

        if (existingPending) {
          if (existingPending.requestedDevice?.clientDeviceIdHash === installationHash) {
            return { status: 'PENDING', requestId: existingPending.id };
          }

          throw new DeviceChangeAlreadyPendingError();
        }

        const requestedDevice =
          sameDevice ??
          (await tx.studentDevice.create({
            data: {
              id: this.uuid.create(),
              studentUserId: input.principal.userId,
              clientDeviceIdHash: installationHash,
              platform: input.metadata.platform,
              status: StudentDeviceStatus.PENDING,
              deviceModel: input.metadata.deviceModel,
              osVersion: input.metadata.osVersion,
              appVersion: input.metadata.appVersion,
            },
          }));

        const request = await tx.deviceChangeRequest.create({
          data: {
            id: this.uuid.create(),
            studentUserId: input.principal.userId,
            currentDeviceId: activeDevice.id,
            requestedDeviceId: requestedDevice.id,
            status: DeviceChangeRequestStatus.PENDING,
            reason: input.reason,
            requestedAt: this.clock.now(),
          },
        });

        await this.recordDeviceEvent(tx, {
          eventType: 'DEVICE_CHANGE_REQUESTED',
          actorUserId: input.principal.userId,
          targetUserId: input.principal.userId,
          deviceId: requestedDevice.id,
          metadata: { request_id: request.id, platform: input.metadata.platform },
        });

        return { status: 'PENDING', requestId: request.id };
      });
    } catch (error: unknown) {
      if (isExpectedDeviceRequestUniquenessError(error)) {
        const existing = await this.findPendingRequestForHash(input.principal.userId, installationHash);
        if (existing) {
          return { status: 'PENDING', requestId: existing.id };
        }
        throw new DeviceChangeAlreadyPendingError();
      }

      throw error;
    }
  }

  async approveDeviceChange(input: {
    adminPrincipal: AuthenticatedPrincipal;
    requestId: string;
    reviewNote?: string;
  }): Promise<void> {
    this.assertRequestId(input.requestId);
    await this.prismaService.client.$transaction(async (tx) => {
      const requestOwner = await tx.deviceChangeRequest.findUnique({
        where: { id: input.requestId },
        select: { studentUserId: true },
      });

      if (!requestOwner) {
        throw new DeviceChangeRequestNotFoundError();
      }

      await this.lockStudentDeviceState(tx, requestOwner.studentUserId);
      await this.assertActivePlatformAdmin(tx, input.adminPrincipal.userId);

      const request = await tx.deviceChangeRequest.findUnique({
        where: { id: input.requestId },
        include: { requestedDevice: true, student: true },
      });

      if (!request) {
        throw new DeviceChangeRequestNotFoundError();
      }

      if (request.status !== DeviceChangeRequestStatus.PENDING) {
        throw new DeviceChangeRequestAlreadyResolvedError();
      }

      if (
        request.student.platformRole !== PlatformRole.STUDENT ||
        request.student.accountStatus !== AccountStatus.ACTIVE ||
        !request.requestedDevice
      ) {
        throw new DeviceAccountInactiveError();
      }

      const claimed = await tx.deviceChangeRequest.updateMany({
        where: { id: input.requestId, status: DeviceChangeRequestStatus.PENDING },
        data: {
          status: DeviceChangeRequestStatus.APPROVED,
          reviewedByUserId: input.adminPrincipal.userId,
          reviewedAt: this.clock.now(),
          reviewNote: input.reviewNote,
        },
      });

      if (claimed.count !== 1) {
        throw new DeviceChangeRequestAlreadyResolvedError();
      }

      await tx.studentDevice.updateMany({
        where: {
          studentUserId: request.studentUserId,
          status: StudentDeviceStatus.ACTIVE,
          id: { not: request.requestedDevice.id },
        },
        data: {
          status: StudentDeviceStatus.REPLACED,
          revokedAt: this.clock.now(),
          revokedReason: 'Replaced by approved device change request.',
        },
      });

      await tx.studentDevice.update({
        where: { id: request.requestedDevice.id },
        data: {
          status: StudentDeviceStatus.ACTIVE,
          approvedAt: this.clock.now(),
          activatedAt: this.clock.now(),
          lastSeenAt: this.clock.now(),
        },
      });

      await this.recordDeviceEvent(tx, {
        eventType: 'DEVICE_CHANGE_APPROVED',
        actorUserId: input.adminPrincipal.userId,
        targetUserId: request.studentUserId,
        deviceId: request.requestedDevice.id,
        severity: SecurityEventSeverity.HIGH,
        metadata: { request_id: request.id },
      });
    });
  }

  async rejectDeviceChange(input: {
    adminPrincipal: AuthenticatedPrincipal;
    requestId: string;
    reviewNote?: string;
  }): Promise<void> {
    this.assertRequestId(input.requestId);
    await this.prismaService.client.$transaction(async (tx) => {
      const requestOwner = await tx.deviceChangeRequest.findUnique({
        where: { id: input.requestId },
        select: { studentUserId: true },
      });

      if (!requestOwner) {
        throw new DeviceChangeRequestNotFoundError();
      }

      await this.lockStudentDeviceState(tx, requestOwner.studentUserId);
      await this.assertActivePlatformAdmin(tx, input.adminPrincipal.userId);

      const request = await tx.deviceChangeRequest.findUnique({
        where: { id: input.requestId },
        include: { requestedDevice: true, student: true },
      });

      if (!request) {
        throw new DeviceChangeRequestNotFoundError();
      }

      if (request.status !== DeviceChangeRequestStatus.PENDING) {
        throw new DeviceChangeRequestAlreadyResolvedError();
      }

      if (
        request.student.platformRole !== PlatformRole.STUDENT ||
        request.student.accountStatus !== AccountStatus.ACTIVE
      ) {
        throw new DeviceAccountInactiveError();
      }

      const claimed = await tx.deviceChangeRequest.updateMany({
        where: { id: input.requestId, status: DeviceChangeRequestStatus.PENDING },
        data: {
          status: DeviceChangeRequestStatus.REJECTED,
          reviewedByUserId: input.adminPrincipal.userId,
          reviewedAt: this.clock.now(),
          reviewNote: input.reviewNote,
        },
      });

      if (claimed.count !== 1) {
        throw new DeviceChangeRequestAlreadyResolvedError();
      }

      if (request.requestedDevice) {
        await tx.studentDevice.update({
          where: { id: request.requestedDevice.id },
          data: {
            status: StudentDeviceStatus.REVOKED,
            revokedAt: this.clock.now(),
            revokedReason: 'Rejected device change request.',
          },
        });
      }

      await this.recordDeviceEvent(tx, {
        eventType: 'DEVICE_CHANGE_REJECTED',
        actorUserId: input.adminPrincipal.userId,
        targetUserId: request.studentUserId,
        deviceId: request.requestedDeviceId,
        severity: SecurityEventSeverity.WARN,
        metadata: { request_id: request.id },
      });
    });
  }

  async listPendingDeviceChangeRequests(input: {
    adminPrincipal: AuthenticatedPrincipal;
    limit?: number;
    offset?: number;
  }): Promise<DeviceChangeRequestSummary[]> {
    await this.assertActivePlatformAdmin(this.prismaService.client, input.adminPrincipal.userId);
    const limit = input.limit ?? 25;
    const offset = input.offset ?? 0;

    const requests = await this.prismaService.client.deviceChangeRequest.findMany({
      where: { status: DeviceChangeRequestStatus.PENDING },
      orderBy: { requestedAt: 'asc' },
      skip: offset,
      take: limit,
      include: { requestedDevice: true },
    });

    return requests.map((request) => ({
      id: request.id,
      studentUserId: request.studentUserId,
      requestedAt: request.requestedAt,
      requestedPlatform: request.requestedDevice?.platform ?? null,
      requestedDeviceModel: request.requestedDevice?.deviceModel ?? null,
      requestedOsVersion: request.requestedDevice?.osVersion ?? null,
      requestedAppVersion: request.requestedDevice?.appVersion ?? null,
      currentDeviceId: request.currentDeviceId,
    }));
  }

  async assertAuthorizedStudentDevice(input: {
    principal: AuthenticatedPrincipal;
    installationId: string;
  }): Promise<void> {
    const result = await this.checkStudentDeviceAuthorization(input);
    if (result.status !== 'AUTHORIZED') {
      throw new DeviceNotAuthorizedError();
    }
  }

  normalizeInstallationId(value: string | string[] | undefined): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new DeviceInstallationIdRequiredError();
    }

    const normalized = value.trim().toLowerCase();
    this.assertUuid(normalized);
    return normalized;
  }

  private hashInstallationId(installationId: string): string {
    const normalized = this.normalizeInstallationId(installationId);
    return this.tokenCrypto.hashOpaqueToken(normalized);
  }

  private async authorizeFirstDeviceWithinTransaction(
    tx: PrismaTransactionClient,
    studentUserId: string,
    installationHash: string,
    metadata: DeviceMetadata,
  ): Promise<StudentDevice> {
    const existing = await this.findDeviceByHash(tx, studentUserId, installationHash);

    if (existing?.status === StudentDeviceStatus.ACTIVE) {
      return existing;
    }

    if (existing) {
      throw new DeviceChangeAlreadyPendingError();
    }

    const device = await tx.studentDevice.create({
      data: {
        id: this.uuid.create(),
        studentUserId,
        clientDeviceIdHash: installationHash,
        platform: metadata.platform,
        status: StudentDeviceStatus.ACTIVE,
        approvedAt: this.clock.now(),
        activatedAt: this.clock.now(),
        lastSeenAt: this.clock.now(),
        deviceModel: metadata.deviceModel,
        osVersion: metadata.osVersion,
        appVersion: metadata.appVersion,
      },
    });

    await this.recordDeviceEvent(tx, {
      eventType: 'STUDENT_DEVICE_APPROVED',
      actorUserId: studentUserId,
      targetUserId: studentUserId,
      deviceId: device.id,
      metadata: { approval_source: 'first_device' },
    });

    return device;
  }

  private async assertActiveStudent(
    client: PrismaService['client'] | PrismaTransactionClient,
    userId: string,
  ): Promise<void> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DeviceAccountInactiveError();
    }

    if (user.platformRole !== PlatformRole.STUDENT) {
      throw new StudentRequiredError();
    }
  }

  private async assertActivePlatformAdmin(
    client: PrismaService['client'] | PrismaTransactionClient,
    userId: string,
  ): Promise<void> {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, platformRole: true },
    });

    if (!user || user.accountStatus !== AccountStatus.ACTIVE) {
      throw new DeviceAccountInactiveError();
    }

    if (user.platformRole !== PlatformRole.PLATFORM_ADMIN) {
      throw new PlatformAdminRequiredError();
    }
  }

  private assertStudentPrincipal(principal: AuthenticatedPrincipal): void {
    if (principal.platformRole !== PlatformRole.STUDENT) {
      throw new StudentRequiredError();
    }
  }

  private assertUuid(value: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new DeviceInstallationIdInvalidError();
    }
  }

  private assertRequestId(value: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new DeviceChangeRequestNotFoundError();
    }
  }

  private async findActiveDevice(
    client: PrismaService['client'] | PrismaTransactionClient,
    studentUserId: string,
  ): Promise<StudentDevice | null> {
    return client.studentDevice.findFirst({
      where: { studentUserId, status: StudentDeviceStatus.ACTIVE },
    });
  }

  private async findDeviceByHash(
    client: PrismaService['client'] | PrismaTransactionClient,
    studentUserId: string,
    installationHash: string,
  ): Promise<StudentDevice | null> {
    return client.studentDevice.findUnique({
      where: {
        studentUserId_clientDeviceIdHash: {
          studentUserId,
          clientDeviceIdHash: installationHash,
        },
      },
    });
  }

  private async findPendingRequestForHash(
    studentUserId: string,
    installationHash: string,
  ): Promise<{ id: string } | null> {
    return this.prismaService.client.deviceChangeRequest.findFirst({
      where: {
        studentUserId,
        status: DeviceChangeRequestStatus.PENDING,
        requestedDevice: { clientDeviceIdHash: installationHash },
      },
      select: { id: true },
    });
  }

  private async touchDevice(
    client: PrismaService['client'] | PrismaTransactionClient,
    id: string,
    metadata?: Partial<DeviceMetadata>,
  ): Promise<void> {
    await client.studentDevice.update({
      where: { id },
      data: {
        lastSeenAt: this.clock.now(),
        deviceModel: metadata?.deviceModel,
        osVersion: metadata?.osVersion,
        appVersion: metadata?.appVersion,
      },
    });
  }

  private async recordDeviceEvent(
    tx: PrismaTransactionClient,
    input: Parameters<SecurityEventService['recordWithinTransaction']>[1],
  ): Promise<void> {
    await this.securityEvents.recordWithinTransaction(tx, {
      ...input,
      category: SecurityEventCategory.DEVICE,
    });
  }

  private async lockStudentDeviceState(
    tx: PrismaTransactionClient,
    studentUserId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studentUserId}, 0::bigint))`;
  }
}

const DEVICE_UNIQUE_CONSTRAINTS = new Set([
  'student_devices_one_active_per_student_key',
  'student_devices_student_user_id_client_device_id_hash_key',
]);

const DEVICE_REQUEST_UNIQUE_CONSTRAINTS = new Set([
  ...DEVICE_UNIQUE_CONSTRAINTS,
  'device_change_requests_one_pending_per_student_key',
]);

function isExpectedDeviceUniquenessError(error: unknown): boolean {
  return isKnownUniqueConstraint(error, DEVICE_UNIQUE_CONSTRAINTS);
}

function isExpectedDeviceRequestUniquenessError(error: unknown): boolean {
  return isKnownUniqueConstraint(error, DEVICE_REQUEST_UNIQUE_CONSTRAINTS);
}

function isKnownUniqueConstraint(error: unknown, expected: ReadonlySet<string>): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.target;

  if (typeof target === 'string') {
    return expected.has(target);
  }

  if (Array.isArray(target)) {
    return target.some((value) => typeof value === 'string' && expected.has(value));
  }

  return false;
}
