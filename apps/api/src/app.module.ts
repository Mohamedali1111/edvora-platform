import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeviceModule } from './modules/devices/device.module';

@Module({
  imports: [DatabaseModule, AuthModule, DeviceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
