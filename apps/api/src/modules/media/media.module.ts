import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InstructorMediaController } from './http/instructor-media.controller';
import { MediaAssetService } from './services/media-asset.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TenancyModule,
    ThrottlerModule.forRoot([
      {
        name: 'media',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [InstructorMediaController],
  providers: [MediaAssetService],
  exports: [MediaAssetService],
})
export class MediaModule {}
