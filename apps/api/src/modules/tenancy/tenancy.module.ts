import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceModule } from '../devices/device.module';
import { AdminInstructorController } from './http/admin-instructor.controller';
import { InstructorEnrollmentController } from './http/instructor-enrollment.controller';
import { InstructorStudentController } from './http/instructor-student.controller';
import { InstructorTenantController } from './http/instructor-tenant.controller';
import { StudentEnrollmentController } from './http/student-enrollment.controller';
import { EnrollmentService } from './services/enrollment.service';
import { InstructorOnboardingService } from './services/instructor-onboarding.service';
import { InstructorTenantService } from './services/instructor-tenant.service';
import { StudentAssociationService } from './services/student-association.service';
import { TenantAuthorizationService } from './services/tenant-authorization.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    DeviceModule,
    ThrottlerModule.forRoot([
      {
        name: 'tenancy',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [
    AdminInstructorController,
    InstructorEnrollmentController,
    InstructorStudentController,
    InstructorTenantController,
    StudentEnrollmentController,
  ],
  providers: [
    EnrollmentService,
    InstructorOnboardingService,
    InstructorTenantService,
    StudentAssociationService,
    TenantAuthorizationService,
  ],
  exports: [EnrollmentService, InstructorTenantService, StudentAssociationService, TenantAuthorizationService],
})
export class TenancyModule {}
