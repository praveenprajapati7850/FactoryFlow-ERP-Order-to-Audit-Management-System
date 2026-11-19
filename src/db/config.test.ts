import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDatabaseConfig,
  toPgPoolConfig,
  getSafeDatabaseDiagnostics,
} from './config.ts';

test('resolves AI Studio Cloud SQL Auth Proxy Unix socket configuration via SQL_HOST and SQL_DB_NAME', () => {
  const cfg = resolveDatabaseConfig({
    SQL_HOST: '/cloudsql/project-id:asia-southeast1:factoryflow-pg',
    SQL_PORT: '5432',
    SQL_DB_NAME: 'factoryflow_db',
    SQL_USER: 'app_user',
    SQL_PASSWORD: 'super-secret-password',
  });

  assert.equal(cfg.mode, 'cloudsql_unix_socket');
  assert.equal(cfg.host, '/cloudsql/project-id:asia-southeast1:factoryflow-pg');
  assert.equal(cfg.port, undefined); // Port must be omitted for Unix sockets
  assert.equal(cfg.database, 'factoryflow_db');
  assert.equal(cfg.user, 'app_user');
  assert.equal(cfg.ssl, false);
  assert.equal(cfg.max, 10);
  assert.equal(cfg.connectionTimeoutMillis, 15000);
});

test('resolves Google Cloud Run Unix socket automatically from INSTANCE_CONNECTION_NAME and SQL_DATABASE', () => {
  const cfg = resolveDatabaseConfig({
    INSTANCE_CONNECTION_NAME: 'my-gcp-project:asia-south1:factoryflow-sql',
    SQL_DATABASE: 'factoryflow',
    SQL_USER: 'factoryflow_app',
    SQL_PASSWORD: 'strong-password-123',
  });

  assert.equal(cfg.mode, 'cloudsql_unix_socket');
  assert.equal(cfg.host, '/cloudsql/my-gcp-project:asia-south1:factoryflow-sql');
  assert.equal(cfg.port, undefined);
  assert.equal(cfg.database, 'factoryflow');
  assert.equal(cfg.user, 'factoryflow_app');

  const poolCfg = toPgPoolConfig(cfg);
  assert.equal(poolCfg.host, '/cloudsql/my-gcp-project:asia-south1:factoryflow-sql');
  assert.equal(poolCfg.database, 'factoryflow');
  assert.equal(poolCfg.keepAlive, true);
});

test('resolves local TCP Cloud SQL Auth Proxy configuration with explicit SQL_PORT and optional admin credentials', () => {
  const appCfg = resolveDatabaseConfig({
    SQL_HOST: '127.0.0.1',
    SQL_PORT: '5432',
    SQL_DATABASE: 'factoryflow',
    SQL_USER: 'factoryflow_app',
    SQL_PASSWORD: 'app-password',
    SQL_ADMIN_USER: 'factoryflow_admin',
    SQL_ADMIN_PASSWORD: 'admin-password',
  });

  assert.equal(appCfg.mode, 'cloud_sql_auth_proxy_or_tcp');
  assert.equal(appCfg.host, '127.0.0.1');
  assert.equal(appCfg.port, 5432);
  assert.equal(appCfg.user, 'factoryflow_app');

  const adminCfg = resolveDatabaseConfig(
    {
      SQL_HOST: '127.0.0.1',
      SQL_PORT: '5432',
      SQL_DATABASE: 'factoryflow',
      SQL_USER: 'factoryflow_app',
      SQL_PASSWORD: 'app-password',
      SQL_ADMIN_USER: 'factoryflow_admin',
      SQL_ADMIN_PASSWORD: 'admin-password',
    },
    { useAdminCredentials: true }
  );

  assert.equal(adminCfg.user, 'factoryflow_admin');
  assert.equal(adminCfg.password, 'admin-password');
});

test('safe diagnostics never expose passwords or usernames', () => {
  const cfg = resolveDatabaseConfig({
    INSTANCE_CONNECTION_NAME: 'proj:asia-south1:inst',
    SQL_DATABASE: 'factoryflow',
    SQL_USER: 'secret_user',
    SQL_PASSWORD: 'super_secret_password',
  });
  const diag = getSafeDatabaseDiagnostics(cfg);
  const serialized = JSON.stringify(diag);
  assert.equal(serialized.includes('super_secret_password'), false);
  assert.equal(serialized.includes('secret_user'), false);
  assert.equal(diag.mode, 'cloudsql_unix_socket');
  assert.equal(diag.database, 'factoryflow');
});

test('normal runtime DB config strictly isolates SQL_ADMIN_USER and SQL_ADMIN_PASSWORD', () => {
  const runtimeCfg = resolveDatabaseConfig({
    SQL_HOST: '127.0.0.1',
    SQL_PORT: '5432',
    SQL_DATABASE: 'factoryflow',
    SQL_ADMIN_USER: 'cloudsql_superuser',
    SQL_ADMIN_PASSWORD: 'superuser-secret-password',
  });
  assert.equal(runtimeCfg.user, '');
  assert.equal(runtimeCfg.password, '');
});
