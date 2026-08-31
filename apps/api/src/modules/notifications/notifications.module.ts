import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceModule } from '../devices/device.module';
import { InstructorNotificationController } from './http/instructor-notification.controller';
import { StudentNotificationController } from './http/student-notification.controller';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    DeviceModule,
    ThrottlerModule.forRoot([
      {
        name: 'notifications',
        ttl: 60_000,
        limit: 60,
      },
    ]),
  ],
  controllers: [InstructorNotificationController, StudentNotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
