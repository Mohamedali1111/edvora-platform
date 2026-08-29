import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AdminDeviceController } from './http/admin-device.controller';
import { StudentDeviceController } from './http/student-device.controller';
import { StudentDeviceGuard } from './http/student-device.guard';
import { StudentDeviceService } from './services/student-device.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    ThrottlerModule.forRoot([
      {
        name: 'device',
        ttl: 60_000,
        limit: 20,
      },
    ]),
  ],
  controllers: [AdminDeviceController, StudentDeviceController],
  providers: [StudentDeviceGuard, StudentDeviceService],
  exports: [StudentDeviceGuard, StudentDeviceService],
})
export class DeviceModule {}
