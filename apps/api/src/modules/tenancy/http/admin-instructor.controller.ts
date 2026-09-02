import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { setNoStore } from '../../auth/http/no-store';
import type { OffsetPage } from '../../../infrastructure/http/pagination';
import { CreateInstructorDto } from '../dto/create-instructor.dto';
import { InstructorIdParamDto } from '../dto/uuid-param.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { InstructorOnboardingService } from '../services/instructor-onboarding.service';
import type { ActivationTokenResult, CreatedInstructorResult, InstructorSummary } from '../types/tenancy.types';

type InstructorListResponse = OffsetPage<InstructorSummary>;

const TENANCY_THROTTLE = {
  tenancy: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('admin/instructors')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(TENANCY_THROTTLE)
export class AdminInstructorController {
  constructor(private readonly instructors: InstructorOnboardingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Body() body: CreateInstructorDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreatedInstructorResult> {
    setNoStore(response);
    return this.instructors.createInstructor({
      principal,
      email: body.email,
      displayName: body.displayName,
      tenantName: body.tenantName,
      tenantSlug: body.tenantSlug,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Query() query: PaginationQueryDto,
  ): Promise<InstructorListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const { items, hasMore } = await this.instructors.listInstructors(principal, limit, offset);
    return { items, limit, offset, hasMore };
  }

  @Get(':instructorId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: InstructorIdParamDto,
  ): Promise<InstructorSummary> {
    return this.instructors.getInstructorDetails(principal, params.instructorId);
  }

  /**
   * G-02 repair: issues a fresh one-time `INSTRUCTOR_ACTIVATION` token for an Instructor who has
   * not yet completed activation — the Admin-facing recovery path for a lost or expired code.
   * `AccessTokenGuard` (class-level, above) already restricts this to an authenticated principal;
   * `InstructorOnboardingService.reissueActivation` re-asserts PLATFORM_ADMIN server-side inside
   * its own transaction, exactly like every other route on this controller.
   */
  @Post(':instructorId/activation')
  @HttpCode(HttpStatus.CREATED)
  async reissueActivation(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: InstructorIdParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ActivationTokenResult> {
    setNoStore(response);
    return this.instructors.reissueActivation(principal, params.instructorId);
  }
}
