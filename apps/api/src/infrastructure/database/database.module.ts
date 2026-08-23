import { Module } from '@nestjs/common';
import { createDatabaseRuntimeConfig } from './database.config';
import { DATABASE_RUNTIME_CONFIG } from './database.constants';
import { PrismaService } from './prisma.service';

@Module({
  providers: [
    {
      provide: DATABASE_RUNTIME_CONFIG,
      useFactory: createDatabaseRuntimeConfig,
    },
    PrismaService,
  ],
  exports: [PrismaService],
})
export class DatabaseModule {}
