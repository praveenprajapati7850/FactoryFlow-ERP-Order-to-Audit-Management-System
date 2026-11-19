import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateJwtSecret, isSecureRequest } from './src/middleware/authPolicy.ts';
import { csrfProtection } from './src/middleware/auth.ts';
import { checkDatabaseHealth, closeDatabasePool } from './src/db/index.ts';
import { authAndAdminRouter } from './src/routes/authAndAdminRoutes.ts';
import { mastersRouter } from './src/routes/mastersRoutes.ts';
import { productionRouter } from './src/routes/productionRoutes.ts';
import { salesAndFinanceRouter } from './src/routes/salesAndFinanceRoutes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Fail securely at boot if JWT_SECRET is missing or weak
  validateJwtSecret(process.env.JWT_SECRET);

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  // Production security headers (compatible with Cloud Run HTTPS & embedded preview iframes)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isSecureRequest(req, process.env.APP_URL)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if (req.path.startsWith('/api/auth')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  // Operational & Database health check endpoints (on-demand; never called eagerly at boot)
  app.get('/api/health', async (_req, res) => {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.connected) {
      return res.status(503).json({
        ok: false,
        service: 'FactoryFlow ERP',
        database: 'unavailable',
        error: 'Database service unavailable',
      });
    }
    return res.json({
      ok: true,
      service: 'FactoryFlow ERP',
      database: 'connected',
      mode: dbHealth.mode,
      latencyMs: dbHealth.latencyMs,
    });
  });

  app.get('/api/health/db', async (_req, res) => {
    const dbHealth = await checkDatabaseHealth();
    if (!dbHealth.connected) {
      return res.status(503).json({
        ok: false,
        database: 'unavailable',
        error: 'Database connection failed',
      });
    }
    return res.json({
      ok: true,
      database: 'connected',
      mode: dbHealth.mode,
      latencyMs: dbHealth.latencyMs,
    });
  });

  // Enforce strict Origin/Referer validation & double-submit CSRF protection on all /api mutations
  app.use('/api', csrfProtection);

  app.use('/api', authAndAdminRouter);
  app.use('/api', mastersRouter);
  app.use('/api', productionRouter);
  app.use('/api', salesAndFinanceRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FactoryFlow ERP server running on http://0.0.0.0:${PORT}`);
  });

  let shuttingDown = false;
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[FactoryFlow ERP] Received ${signal}. Draining HTTP connections and closing Cloud SQL pool...`);
    server.close(async () => {
      try {
        await closeDatabasePool();
        console.log('[FactoryFlow ERP] PostgreSQL connection pool closed cleanly.');
        process.exit(0);
      } catch (err) {
        console.error('[FactoryFlow ERP] Error closing PostgreSQL pool:', err);
        process.exit(1);
      }
    });
    // Force exit if connections hang beyond Cloud Run grace window
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start FactoryFlow ERP server:', err);
  process.exit(1);
});
