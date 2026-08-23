const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export type DatabasePoolConfig = {
  maxConnections: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
};

export type DatabaseRuntimeConfig = {
  databaseUrl: string;
  pool: DatabasePoolConfig;
};

const DEFAULT_DATABASE_POOL_CONFIG: DatabasePoolConfig = {
  maxConnections: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 10_000,
};

export function createDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfig {
  return {
    databaseUrl: readDatabaseUrl(env.DATABASE_URL),
    pool: DEFAULT_DATABASE_POOL_CONFIG,
  };
}

function readDatabaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new Error('DATABASE_URL is required to start the API database runtime.');
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!POSTGRES_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgresql:// or postgres:// protocol.');
  }

  if (!parsedUrl.hostname) {
    throw new Error('DATABASE_URL must include a database host.');
  }

  return trimmed;
}
