import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
// Imported only for `StudentCourseAccessService` (the one canonical student entitlement chain,
// minimally extended with `assertAccessibleDocumentLesson` rather than duplicated here), mirroring
// exactly how QuizzesModule imports CoursesModule. CoursesModule does not import MediaModule, so
// this stays a one-directional dependency, not a cycle.
import { CoursesModule } from '../courses/courses.module';
import { DeviceModule } from '../devices/device.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorMediaController } from './http/instructor-media.controller';
import { StudentDocumentController } from './http/student-document.controller';
import { MediaAssetService } from './services/media-asset.service';
import { StudentDocumentAccessService } from './services/student-document-access.service';

@Module({
  imports: [
    AuthModule,
    CoursesModule,
    DatabaseModule,
    DeviceModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'media',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [InstructorMediaController, StudentDocumentController],
  providers: [MediaAssetService, StudentDocumentAccessService],
  exports: [MediaAssetService],
})
export class MediaModule {}
