import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { resolveDatabaseConfig } from './config.ts';

dotenv.config();

const adminConfig = resolveDatabaseConfig(process.env, { useAdminCredentials: true });
const fallbackUser = adminConfig.user || process.env.SQL_USER?.trim() || '';
const fallbackPassword = adminConfig.password || process.env.SQL_PASSWORD || '';

if (!adminConfig.host) {
  throw new Error('SQL_HOST or INSTANCE_CONNECTION_NAME must be set in environment variables.');
}
if (!adminConfig.database) {
  throw new Error('SQL_DB_NAME or SQL_DATABASE must be set in environment variables.');
}
if (!fallbackUser) {
  throw new Error('SQL_ADMIN_USER (or SQL_USER for local dev) must be set in environment variables.');
}
if (!fallbackPassword) {
  throw new Error('SQL_ADMIN_PASSWORD (or SQL_PASSWORD for local dev) must be set in environment variables.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: adminConfig.host,
    ...(adminConfig.port !== undefined ? { port: adminConfig.port } : {}),
    user: fallbackUser,
    password: fallbackPassword,
    database: adminConfig.database,
    ssl: adminConfig.ssl,
  },
  verbose: true,
});
