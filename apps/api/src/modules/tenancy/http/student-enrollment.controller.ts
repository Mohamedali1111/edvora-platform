import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { EnrollmentService } from '../services/enrollment.service';
import type { StudentEnrollmentSummary } from '../types/tenancy.types';

type StudentEnrollmentListResponse = {
  items: StudentEnrollmentSummary[];
  limit: number;
  offset: number;
};

const TENANCY_THROTTLE = {
  tenancy: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/enrollments')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(TENANCY_THROTTLE)
export class StudentEnrollmentController {
  constructor(private readonly enrollments: EnrollmentService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<StudentEnrollmentListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.enrollments.listStudentEnrollments(principal, limit, offset),
      limit,
      offset,
    };
  }
}
