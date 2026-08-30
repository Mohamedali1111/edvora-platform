import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
// Imported only for `StudentCourseAccessService` (the one canonical student entitlement chain,
// minimally extended with `assertAccessibleDocumentLesson`/`assertAccessibleVideoLesson` rather
// than duplicated here), mirroring exactly how QuizzesModule imports CoursesModule. CoursesModule
// does not import MediaModule, so this stays a one-directional dependency, not a cycle.
import { CoursesModule } from '../courses/courses.module';
import { DeviceModule } from '../devices/device.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { createMediaRuntimeConfig } from './media.config';
import { DOCUMENT_STORAGE_PROVIDER, MEDIA_RUNTIME_CONFIG, VIDEO_PROVIDER } from './media.constants';
import { BunnyStreamWebhookController } from './http/bunny-stream-webhook.controller';
import { InstructorMediaController } from './http/instructor-media.controller';
import { StudentDocumentController } from './http/student-document.controller';
import { StudentVideoController } from './http/student-video.controller';
import { MediaAssetService } from './services/media-asset.service';
import { StudentDocumentAccessService } from './services/student-document-access.service';
import { StudentVideoAccessService } from './services/student-video-access.service';
import { R2DocumentStorageProvider } from './storage/r2-document-storage.provider';
import { BunnyStreamVideoProvider } from './video/bunny-stream-video.provider';

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
  controllers: [
    BunnyStreamWebhookController,
    InstructorMediaController,
    StudentDocumentController,
    StudentVideoController,
  ],
  providers: [
    {
      provide: MEDIA_RUNTIME_CONFIG,
      useFactory: createMediaRuntimeConfig,
    },
    {
      provide: DOCUMENT_STORAGE_PROVIDER,
      useClass: R2DocumentStorageProvider,
    },
    {
      provide: VIDEO_PROVIDER,
      useClass: BunnyStreamVideoProvider,
    },
    MediaAssetService,
    StudentDocumentAccessService,
    StudentVideoAccessService,
  ],
  exports: [MediaAssetService],
})
export class MediaModule {}
