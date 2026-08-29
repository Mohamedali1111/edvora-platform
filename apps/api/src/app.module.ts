import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './infrastructure/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeviceModule } from './modules/devices/device.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';

@Module({
  imports: [DatabaseModule, AuthModule, DeviceModule, TenancyModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
