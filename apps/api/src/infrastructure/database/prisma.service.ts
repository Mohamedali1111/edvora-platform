import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../../.generated/prisma/client';
import type { DatabaseRuntimeConfig } from './database.config';
import { DATABASE_RUNTIME_CONFIG } from './database.constants';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly prisma: PrismaClient;

  constructor(
    @Inject(DATABASE_RUNTIME_CONFIG)
    private readonly config: DatabaseRuntimeConfig,
  ) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.pool.maxConnections,
      connectionTimeoutMillis: config.pool.connectionTimeoutMillis,
      idleTimeoutMillis: config.pool.idleTimeoutMillis,
    });

    this.pool.on('error', () => {
      this.logger.error('PostgreSQL pool emitted an idle client error.');
    });

    const adapter = new PrismaPg(this.pool, { disposeExternalPool: true });
    this.prisma = new PrismaClient({ adapter });
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$connect();
    } catch {
      throw new Error('Unable to connect to PostgreSQL. Verify DATABASE_URL and database availability.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
