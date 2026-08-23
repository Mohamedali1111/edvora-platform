import { Test } from '@nestjs/testing';
import type { DatabaseRuntimeConfig } from './database.config';
import { DATABASE_RUNTIME_CONFIG } from './database.constants';
import { DatabaseModule } from './database.module';
import { PrismaService } from './prisma.service';

const testConfig: DatabaseRuntimeConfig = {
  databaseUrl: 'postgresql://edvora_test:temporary@localhost:55432/edvora_migration_test',
  pool: {
    maxConnections: 1,
    connectionTimeoutMillis: 100,
    idleTimeoutMillis: 100,
  },
};

describe('PrismaService', () => {
  it('is provided as one Nest-managed database boundary instance', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    })
      .overrideProvider(DATABASE_RUNTIME_CONFIG)
      .useValue(testConfig)
      .compile();

    expect(moduleRef.get(PrismaService)).toBe(moduleRef.get(PrismaService));

    await moduleRef.close();
  });

  it('fails startup with a sanitized connection error', async () => {
    const service = new PrismaService(testConfig);
    const connectSpy = jest
      .spyOn(service.client, '$connect')
      .mockRejectedValue(new Error(`connection failed: ${testConfig.databaseUrl}`));

    await expect(service.onModuleInit()).rejects.toThrow(
      'Unable to connect to PostgreSQL. Verify DATABASE_URL and database availability.',
    );
    expect(connectSpy).toHaveBeenCalledTimes(1);

    await service.onModuleDestroy();
  });

  it('disconnects Prisma and the adapter-owned pool during shutdown', async () => {
    const service = new PrismaService(testConfig);
    const disconnectSpy = jest.spyOn(service.client, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
