import type { PoolConfig } from 'pg';

export type DatabaseConnectionMode =
  | 'cloudsql_unix_socket'
  | 'cloud_sql_auth_proxy_or_tcp';

export interface ResolvedDatabaseConfig {
  mode: DatabaseConnectionMode;
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean | { rejectUnauthorized: boolean };
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  keepAlive: boolean;
}

/**
 * Resolves PostgreSQL connection parameters using the pg.Pool Object Method.
 *
 * Supported environments:
 * 1. AI Studio / Cloud SQL Auth Proxy (SQL_HOST, SQL_DB_NAME, SQL_USER, SQL_PASSWORD)
 * 2. Google Cloud Run with Cloud SQL integration (INSTANCE_CONNECTION_NAME -> /cloudsql/<name>, SQL_DATABASE)
 * 3. Local development TCP PostgreSQL or Auth Proxy (SQL_HOST=127.0.0.1, SQL_PORT=5432, SQL_DATABASE)
 *
 * Never uses DATABASE_URL connection strings or hardcoded credentials.
 */
export function resolveDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
  options?: { useAdminCredentials?: boolean }
): ResolvedDatabaseConfig {
  const useAdmin = options?.useAdminCredentials === true;

  const explicitHost = env.SQL_HOST?.trim();
  const instanceConnectionName = env.INSTANCE_CONNECTION_NAME?.trim();

  let host = explicitHost || '';
  if (!host && instanceConnectionName) {
    host = `/cloudsql/${instanceConnectionName}`;
  }

  const isUnixSocket = host.startsWith('/');
  const mode: DatabaseConnectionMode = isUnixSocket
    ? 'cloudsql_unix_socket'
    : 'cloud_sql_auth_proxy_or_tcp';

  const database = (env.SQL_DB_NAME || env.SQL_DATABASE || '').trim();
  const user = (useAdmin ? env.SQL_ADMIN_USER : env.SQL_USER)?.trim() || '';
  const password = (useAdmin ? env.SQL_ADMIN_PASSWORD : env.SQL_PASSWORD) || '';

  const parsedPort = env.SQL_PORT ? Number(env.SQL_PORT) : undefined;
  const port =
    !isUnixSocket && parsedPort && Number.isFinite(parsedPort) && parsedPort > 0
      ? parsedPort
      : undefined;

  const parsedMax = env.SQL_POOL_MAX ? Number(env.SQL_POOL_MAX) : 10;
  const max = Number.isFinite(parsedMax) && parsedMax >= 1 && parsedMax <= 50 ? parsedMax : 10;

  // Unix sockets (Cloud Run / Cloud SQL Auth Proxy) already encrypt traffic via Cloud SQL Proxy/IAM
  const ssl =
    !isUnixSocket && env.SQL_SSL === 'true'
      ? { rejectUnauthorized: env.SQL_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false;

  return {
    mode,
    host,
    ...(port !== undefined ? { port } : {}),
    database,
    user,
    password,
    ssl,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    keepAlive: true,
  };
}

export function toPgPoolConfig(config: ResolvedDatabaseConfig): PoolConfig {
  return {
    host: config.host || undefined,
    ...(config.port !== undefined ? { port: config.port } : {}),
    database: config.database || undefined,
    user: config.user || undefined,
    password: config.password || undefined,
    ssl: config.ssl,
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    keepAlive: config.keepAlive,
  };
}

/**
 * Returns non-sensitive connection metadata safe for operational diagnostics (never includes secrets).
 */
export function getSafeDatabaseDiagnostics(config: ResolvedDatabaseConfig) {
  return {
    mode: config.mode,
    database: config.database || 'unconfigured',
    poolMax: config.max,
    connectionTimeoutMs: config.connectionTimeoutMillis,
  };
}
