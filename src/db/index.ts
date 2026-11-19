import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema.ts';
import {
  resolveDatabaseConfig,
  toPgPoolConfig,
  getSafeDatabaseDiagnostics,
} from './config.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

const resolvedDbConfig = resolveDatabaseConfig(process.env);

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(toPgPoolConfig(resolvedDbConfig));

    // Prevent unhandled errors on idle pooled clients from crashing the Node process;
    // pg.Pool automatically removes broken clients and opens fresh connections on demand.
    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle Cloud SQL pool client:', err.message);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });

/**
 * Gracefully drains and closes the PostgreSQL connection pool during SIGTERM/SIGINT shutdown.
 */
export async function closeDatabasePool(): Promise<void> {
  if (global._postgresPool) {
    const activePool = global._postgresPool;
    global._postgresPool = undefined;
    await activePool.end();
  }
}

/**
 * On-demand PostgreSQL connectivity check for health endpoints (never called eagerly at startup).
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  latencyMs: number;
  mode: string;
}> {
  const startedAt = Date.now();
  const diag = getSafeDatabaseDiagnostics(resolvedDbConfig);
  try {
    await db.execute(sql`SELECT 1`);
    return {
      connected: true,
      latencyMs: Date.now() - startedAt,
      mode: diag.mode,
    };
  } catch (error) {
    console.error('Cloud SQL health check failed:', error instanceof Error ? error.message : 'Unknown error');
    return {
      connected: false,
      latencyMs: Date.now() - startedAt,
      mode: diag.mode,
    };
  }
}
