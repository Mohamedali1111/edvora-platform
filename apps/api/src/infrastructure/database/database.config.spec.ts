import { createDatabaseRuntimeConfig } from './database.config';

describe('createDatabaseRuntimeConfig', () => {
  it('rejects a missing database URL', () => {
    expect(() => createDatabaseRuntimeConfig({})).toThrow(
      'DATABASE_URL is required to start the API database runtime.',
    );
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() => createDatabaseRuntimeConfig({ DATABASE_URL: 'mysql://localhost/edvora' })).toThrow(
      'DATABASE_URL must use the postgresql:// or postgres:// protocol.',
    );
  });

  it('returns a sanitized runtime config for a valid PostgreSQL URL', () => {
    expect(
      createDatabaseRuntimeConfig({
        DATABASE_URL: 'postgresql://edvora_test:temporary@localhost:55432/edvora_migration_test',
      }),
    ).toEqual({
      databaseUrl: 'postgresql://edvora_test:temporary@localhost:55432/edvora_migration_test',
      pool: {
        maxConnections: 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    });
  });
});
