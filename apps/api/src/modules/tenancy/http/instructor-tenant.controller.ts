import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { TenantIdParamDto } from '../dto/uuid-param.dto';
import { InstructorTenantService } from '../services/instructor-tenant.service';
import type { TenantContextSummary } from '../types/tenancy.types';

const TENANCY_THROTTLE = {
  tenancy: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(TENANCY_THROTTLE)
export class InstructorTenantController {
  constructor(private readonly tenants: InstructorTenantService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentAuth() principal: AuthenticatedPrincipal): Promise<{ items: TenantContextSummary[] }> {
    return { items: await this.tenants.listInstructorTenants(principal) };
  }

  @Get(':tenantId/context')
  @HttpCode(HttpStatus.OK)
  async context(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
  ): Promise<TenantContextSummary> {
    return this.tenants.getTenantContext(principal, params.tenantId);
  }
}
