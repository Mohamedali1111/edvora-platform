import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SecurityEventCategory,
  SecurityEventSeverity,
} from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { PrismaTransactionClient } from '../types/prisma-transaction.type';
import { ClockService } from './clock.service';
import { UuidV7Service } from './uuid-v7.service';

export type AuthSecurityEventType =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'SESSION_REFRESH_REPLAY_DETECTED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'ACCOUNT_ACTIVATED'
  | 'STUDENT_DEVICE_APPROVED'
  | 'DEVICE_CHANGE_REQUESTED'
  | 'DEVICE_CHANGE_APPROVED'
  | 'DEVICE_CHANGE_REJECTED'
  | 'DEVICE_AUTHORIZATION_FAILED';

export type RecordAuthSecurityEventInput = {
  eventType: AuthSecurityEventType;
  severity?: SecurityEventSeverity;
  actorUserId?: string | null;
  targetUserId?: string | null;
  sessionId?: string | null;
  deviceId?: string | null;
  tenantId?: string | null;
  category?: SecurityEventCategory;
  metadata?: Prisma.InputJsonObject;
};

@Injectable()
export class SecurityEventService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly clock: ClockService,
    private readonly uuid: UuidV7Service,
  ) {}

  async recordBestEffort(input: RecordAuthSecurityEventInput): Promise<boolean> {
    try {
      await this.create(this.prismaService.client, input);
      return true;
    } catch {
      return false;
    }
  }

  async recordWithinTransaction(
    tx: PrismaTransactionClient,
    input: RecordAuthSecurityEventInput,
  ): Promise<void> {
    await this.create(tx, input);
  }

  private async create(
    client: PrismaService['client'] | PrismaTransactionClient,
    input: RecordAuthSecurityEventInput,
  ): Promise<void> {
    await client.securityEvent.create({
      data: {
        id: this.uuid.create(),
        eventType: input.eventType,
        category: input.category ?? SecurityEventCategory.AUTHENTICATION,
        severity: input.severity ?? SecurityEventSeverity.INFO,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        deviceId: input.deviceId ?? null,
        sessionId: input.sessionId ?? null,
        tenantId: input.tenantId ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        createdAt: this.clock.now(),
      },
    });
  }
}
