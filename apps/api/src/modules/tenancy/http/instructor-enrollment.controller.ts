import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { CreateEnrollmentDto } from '../dto/create-enrollment.dto';
import { EnrollmentIdParamDto, TenantIdParamDto } from '../dto/uuid-param.dto';
import { EnrollmentService } from '../services/enrollment.service';
import type { EnrollmentSummary } from '../types/tenancy.types';

const TENANCY_THROTTLE = {
  tenancy: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/enrollments')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(TENANCY_THROTTLE)
export class InstructorEnrollmentController {
  constructor(private readonly enrollments: EnrollmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: CreateEnrollmentDto,
  ): Promise<EnrollmentSummary> {
    return this.enrollments.createEnrollment({
      principal,
      tenantId: params.tenantId,
      studentUserId: body.studentUserId,
      courseId: body.courseId,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
    });
  }

  @Post(':enrollmentId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: EnrollmentIdParamDto,
  ): Promise<EnrollmentSummary> {
    return this.enrollments.revokeEnrollment(
      principal,
      params.tenantId,
      params.enrollmentId,
    );
  }
}
