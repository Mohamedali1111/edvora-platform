import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { setNoStore } from '../../auth/http/no-store';
import type { OffsetPage } from '../../../infrastructure/http/pagination';
import { AddStudentDto } from '../dto/add-student.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { TenantIdParamDto, TenantStudentParamDto } from '../dto/uuid-param.dto';
import { StudentAssociationService } from '../services/student-association.service';
import type { AddTenantStudentResult, TenantStudentSummary } from '../types/tenancy.types';

type TenantStudentListResponse = OffsetPage<TenantStudentSummary>;

const TENANCY_THROTTLE = {
  tenancy: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/students')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(TENANCY_THROTTLE)
export class InstructorStudentController {
  constructor(private readonly students: StudentAssociationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: AddStudentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AddTenantStudentResult> {
    setNoStore(response);
    return this.students.addStudent({
      principal,
      tenantId: params.tenantId,
      email: body.email,
      displayName: body.displayName,
    });
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<TenantStudentListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const { items, hasMore } = await this.students.listStudents(principal, params.tenantId, limit, offset);
    return { items, limit, offset, hasMore };
  }

  @Get(':studentUserId')
  @HttpCode(HttpStatus.OK)
  async detail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantStudentParamDto,
  ): Promise<TenantStudentSummary> {
    return this.students.getStudent(principal, params.tenantId, params.studentUserId);
  }
}
