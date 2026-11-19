import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { users, roles, companySettings, auditLogs } from '../db/schema.ts';
import {
  requireAuth,
  requireRole,
  signSessionToken,
  setSessionCookie,
  ensureCsrfCookie,
  clearSessionCookie,
  revokeSessionToken,
  extractRequestToken,
  verifySessionToken,
  getOrCreateFirebaseUser,
  AuthRequest,
  RoleCode,
} from '../middleware/auth.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { assertActiveAuthorizedUser, canAssignRole } from '../middleware/authPolicy.ts';
import { handleRouteError } from '../db/errors.ts';
import { ensureSeeded, seedBenchmarkScenario, DEMO_ACCOUNTS } from '../db/seed.ts';
import { recordAuditLog } from '../db/audit.ts';

export const authAndAdminRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

authAndAdminRouter.get('/auth/demo-accounts', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.json(
    DEMO_ACCOUNTS.map((a) => ({
      email: a.email,
      name: a.name,
      roleCode: a.roleCode,
    }))
  );
});

authAndAdminRouter.post('/auth/login', async (req, res) => {
  try {
    await ensureSeeded();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid email and password are required' });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (found.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const u = found[0];
    const accessCheck = assertActiveAuthorizedUser({
      isActive: u.isActive,
      roleCode: u.roleCode,
    });
    if (!accessCheck.allowed) {
      console.warn(
        '[FactoryFlow Auth] Login blocked by account policy:',
        JSON.stringify({
          endpoint: '/api/auth/login',
          email: u.email,
          roleCode: u.roleCode,
          isActive: u.isActive,
          code: accessCheck.code,
        })
      );
      clearSessionCookie(req, res);
      // HTTP 423 Locked (account awaiting approval / deactivated) avoids reverse-proxy 403 HTML interception
      return res.status(423).json({
        error: accessCheck.error,
        code: accessCheck.code,
      });
    }
    if (!u.passwordHash) {
      return res.status(401).json({ error: 'Please sign in with Google for this account' });
    }
    const valid = await bcrypt.compare(parsed.data.password, u.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const authUser = {
      id: u.id,
      uid: u.uid,
      email: u.email,
      name: u.name,
      roleId: u.roleId,
      roleCode: u.roleCode as RoleCode,
      phone: u.phone || '',
      isActive: u.isActive,
    };
    const token = signSessionToken(authUser);

    await recordAuditLog(db, {
      user: authUser,
      action: 'USER_LOGIN',
      entity: 'Auth',
      referenceId: u.email,
      newValue: { roleCode: u.roleCode },
    });

    const settingsRows = await db.select().from(companySettings).limit(1);
    setSessionCookie(req, res, token);
    res.json({
      token,
      user: authUser,
      company: settingsRows[0] || null,
    });
  } catch (error) {
    console.error('Login failed:', error);
    return handleRouteError(res, error, 'Authentication service failed. Please try again.');
  }
});

/**
 * Exchanges a verified Firebase Google ID token for a server-managed HttpOnly session cookie.
 * Enforces the same PENDING / inactive account security policy as every other auth path.
 */
authAndAdminRouter.post('/auth/session', async (req, res) => {
  try {
    await ensureSeeded();
    const idToken =
      (typeof req.body?.idToken === 'string' && req.body.idToken.trim()) ||
      extractRequestToken(req);
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: Missing Firebase ID token' });
    }

    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch (verifyErr) {
      console.error('Firebase ID token verification failed:', verifyErr);
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired Google sign-in token' });
    }

    const dbUser = await getOrCreateFirebaseUser(
      decoded.uid,
      decoded.email || `${decoded.uid}@firebase.local`,
      decoded.name,
      Boolean(decoded.email_verified)
    );

    const activeCheck = assertActiveAuthorizedUser({
      isActive: dbUser.isActive,
      roleCode: dbUser.roleCode,
    });
    if (!activeCheck.allowed) {
      console.warn(
        '[FactoryFlow Auth] Google session exchange blocked by account policy:',
        JSON.stringify({
          endpoint: '/api/auth/session',
          email: dbUser.email,
          roleCode: dbUser.roleCode,
          isActive: dbUser.isActive,
          code: activeCheck.code,
        })
      );
      clearSessionCookie(req, res);
      // HTTP 423 Locked preserves the JSON Pending Approval / Account Deactivated message behind proxies that intercept 403
      return res.status(423).json({
        error: activeCheck.error,
        code: activeCheck.code,
      });
    }

    const sessionToken = signSessionToken(dbUser);
    await recordAuditLog(db, {
      user: dbUser,
      action: 'USER_LOGIN',
      entity: 'Auth',
      referenceId: dbUser.email,
      newValue: { roleCode: dbUser.roleCode, provider: 'FIREBASE_GOOGLE' },
    });

    const settingsRows = await db.select().from(companySettings).limit(1);
    setSessionCookie(req, res, sessionToken);
    console.info(
      '[FactoryFlow Auth] Google session established:',
      JSON.stringify({
        endpoint: '/api/auth/session',
        email: dbUser.email,
        roleCode: dbUser.roleCode,
      })
    );
    res.json({
      user: dbUser,
      company: settingsRows[0] || null,
    });
  } catch (error) {
    console.error('Google session exchange failed:', error);
    return handleRouteError(res, error, 'Failed to establish authenticated session');
  }
});

authAndAdminRouter.post('/auth/logout', async (req, res) => {
  try {
    const token = extractRequestToken(req);
    if (token) {
      try {
        const decoded = verifySessionToken(token);
        if (decoded?.id) {
          const found = await db.select().from(users).where(eq(users.id, decoded.id)).limit(1);
          if (found.length > 0) {
            await recordAuditLog(db, {
              user: {
                id: found[0].id,
                name: found[0].name,
                roleCode: found[0].roleCode,
              },
              action: 'USER_LOGOUT',
              entity: 'Auth',
              referenceId: found[0].email,
            });
          }
        }
      } catch {
        // Ignore expired/non-JWT token during logout — always clear cookie cleanly
      }
      revokeSessionToken(token);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  } catch (error) {
    clearSessionCookie(req, res);
    console.error('Logout error:', error);
    return handleRouteError(res, error, 'Logout failed');
  }
});

/**
 * Non-401 session probe used on SPA mount to restore an HttpOnly cookie session
 * without generating unauthenticated 401 console errors on the login page.
 */
authAndAdminRouter.get('/auth/session', async (req, res) => {
  try {
    const token = extractRequestToken(req);
    if (!token) {
      return res.json({ authenticated: false, user: null, company: null });
    }
    let decoded: { id?: number } | null = null;
    try {
      decoded = verifySessionToken(token);
    } catch {
      clearSessionCookie(req, res);
      return res.json({ authenticated: false, user: null, company: null });
    }
    if (!decoded?.id) {
      clearSessionCookie(req, res);
      return res.json({ authenticated: false, user: null, company: null });
    }

    await ensureSeeded();
    const found = await db.select().from(users).where(eq(users.id, decoded.id)).limit(1);
    if (found.length === 0) {
      clearSessionCookie(req, res);
      return res.json({ authenticated: false, user: null, company: null });
    }
    const u = found[0];
    const activeCheck = assertActiveAuthorizedUser({ isActive: u.isActive, roleCode: u.roleCode });
    if (!activeCheck.allowed) {
      clearSessionCookie(req, res);
      return res.json({ authenticated: false, user: null, company: null });
    }

    ensureCsrfCookie(req, res);
    const settingsRows = await db.select().from(companySettings).limit(1);
    return res.json({
      authenticated: true,
      user: {
        id: u.id,
        uid: u.uid,
        email: u.email,
        name: u.name,
        roleId: u.roleId,
        roleCode: u.roleCode as RoleCode,
        phone: u.phone || '',
        isActive: u.isActive,
      },
      company: settingsRows[0] || null,
    });
  } catch (error) {
    console.error('Session hydration check failed:', error);
    return res.json({ authenticated: false, user: null, company: null });
  }
});

authAndAdminRouter.get('/auth/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureSeeded();
    const settingsRows = await db.select().from(companySettings).limit(1);
    res.json({
      user: req.user,
      company: settingsRows[0] || null,
    });
  } catch (error) {
    console.error('Failed to fetch session profile:', error);
    return handleRouteError(res, error, 'Failed to load user profile');
  }
});

authAndAdminRouter.get(
  '/users',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'AUDITOR'),
  async (_req: AuthRequest, res) => {
    try {
      await ensureSeeded();
      const allUsers = await db.select().from(users).orderBy(users.id);
      const allRoles = await db.select().from(roles).orderBy(roles.id);
      res.json({
        users: allUsers.map((u) => ({
          id: u.id,
          uid: u.uid,
          email: u.email,
          name: u.name,
          roleId: u.roleId,
          roleCode: u.roleCode,
          phone: u.phone,
          isActive: u.isActive,
          createdAt: u.createdAt,
        })),
        roles: allRoles,
      });
    } catch (error) {
      console.error('Failed to load users:', error);
      return handleRouteError(res, error, 'Failed to load users');
    }
  }
);

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  roleCode: z.enum(['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'SALESMAN', 'AUDITOR']),
  phone: z.string().optional().default(''),
});

authAndAdminRouter.post(
  '/users',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = createUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user data' });
      }
      const rolePolicy = canAssignRole({
        actorRole: req.user!.roleCode,
        targetRole: parsed.data.roleCode,
        targetIsActive: true,
      });
      if (!rolePolicy.allowed) {
        return res.status(403).json({ error: rolePolicy.error });
      }
      const roleRow = await db
        .select()
        .from(roles)
        .where(eq(roles.code, parsed.data.roleCode))
        .limit(1);
      if (roleRow.length === 0) {
        return res.status(400).json({ error: 'Selected role does not exist' });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);
      const [created] = await db
        .insert(users)
        .values({
          uid: `erp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          email,
          name: parsed.data.name.trim(),
          passwordHash,
          roleId: roleRow[0].id,
          roleCode: parsed.data.roleCode,
          phone: parsed.data.phone,
          isActive: true,
        })
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'USER_CREATED',
        entity: 'User',
        referenceId: created.email,
        newValue: { name: created.name, roleCode: created.roleCode },
      });

      res.status(201).json({
        id: created.id,
        email: created.email,
        name: created.name,
        roleCode: created.roleCode,
        phone: created.phone,
        isActive: created.isActive,
      });
    } catch (error) {
      console.error('Create user failed:', error);
      return handleRouteError(res, error, 'Failed to create user');
    }
  }
);

const updateUserSchema = z.object({
  roleCode: z.enum(['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'SALESMAN', 'AUDITOR']).optional(),
  isActive: z.boolean().optional(),
  phone: z.string().optional(),
});

authAndAdminRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid user update payload' });
      }
      const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      const prev = existing[0];
      if (prev.roleCode === 'OWNER' && req.user!.roleCode !== 'OWNER') {
        return res.status(403).json({ error: 'Only an OWNER can modify an OWNER account.' });
      }
      if (prev.id === req.user!.id && parsed.data.isActive === false) {
        return res.status(400).json({ error: 'You cannot deactivate your own active session account.' });
      }
      if (
        prev.id === req.user!.id &&
        prev.roleCode === 'OWNER' &&
        parsed.data.roleCode &&
        parsed.data.roleCode !== 'OWNER'
      ) {
        return res.status(400).json({ error: 'An Owner cannot demote their own active account.' });
      }

      const nextRoleCode = (parsed.data.roleCode ?? prev.roleCode) as RoleCode;
      const nextIsActive = parsed.data.isActive ?? prev.isActive;
      const rolePolicy = canAssignRole({
        actorRole: req.user!.roleCode,
        targetRole: nextRoleCode,
        targetIsActive: nextIsActive,
      });
      if (!rolePolicy.allowed) {
        return res.status(403).json({ error: rolePolicy.error });
      }

      let roleId = prev.roleId;
      let roleCode = prev.roleCode;
      if (parsed.data.roleCode) {
        const r = await db.select().from(roles).where(eq(roles.code, parsed.data.roleCode)).limit(1);
        if (r.length === 0) {
          return res.status(400).json({ error: 'Selected role does not exist' });
        }
        roleId = r[0].id;
        roleCode = r[0].code;
      }
      const [updated] = await db
        .update(users)
        .set({
          roleId,
          roleCode,
          isActive: nextIsActive,
          phone: parsed.data.phone ?? prev.phone,
        })
        .where(eq(users.id, id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: prev.roleCode === 'PENDING' && updated.isActive ? 'USER_APPROVED' : 'USER_UPDATED',
        entity: 'User',
        referenceId: updated.email,
        previousValue: { roleCode: prev.roleCode, isActive: prev.isActive },
        newValue: { roleCode: updated.roleCode, isActive: updated.isActive },
      });

      res.json({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        roleCode: updated.roleCode,
        phone: updated.phone,
        isActive: updated.isActive,
      });
    } catch (error) {
      console.error('Update user failed:', error);
      return handleRouteError(res, error, 'Failed to update user');
    }
  }
);

authAndAdminRouter.get(
  '/settings',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'AUDITOR'),
  async (_req, res) => {
  try {
    await ensureSeeded();
    const rows = await db.select().from(companySettings).limit(1);
    res.json(rows[0] || null);
  } catch (error) {
    console.error('Failed to load settings:', error);
    return handleRouteError(res, error, 'Failed to load company settings');
  }
});

const settingsSchema = z.object({
  companyName: z.string().min(2),
  gstin: z.string().min(10),
  address: z.string().min(5),
  state: z.string().min(2),
  stateCode: z.string().min(2),
  phone: z.string().min(5),
  email: z.string().email(),
  varianceTolerancePct: z.number().min(0.1).max(25),
  costingMethod: z.enum(['WEIGHTED_AVERAGE', 'STANDARD_COST']),
  invoicePrefix: z.string().min(1).max(8),
  financialYear: z.string().min(4).max(10),
});

authAndAdminRouter.put(
  '/settings',
  requireAuth,
  requireRole('OWNER', 'ADMIN'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings' });
      }
      const existing = await db.select().from(companySettings).limit(1);
      if (existing.length === 0) {
        const [ins] = await db.insert(companySettings).values(parsed.data).returning();
        return res.json(ins);
      }
      const prev = existing[0];
      const [updated] = await db
        .update(companySettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(companySettings.id, prev.id))
        .returning();

      await recordAuditLog(db, {
        user: req.user,
        action: 'SETTINGS_UPDATED',
        entity: 'CompanySettings',
        referenceId: String(updated.id),
        previousValue: {
          state: prev.state,
          varianceTolerancePct: prev.varianceTolerancePct,
          costingMethod: prev.costingMethod,
        },
        newValue: {
          state: updated.state,
          varianceTolerancePct: updated.varianceTolerancePct,
          costingMethod: updated.costingMethod,
        },
      });
      res.json(updated);
    } catch (error) {
      console.error('Update settings failed:', error);
      return handleRouteError(res, error, 'Failed to update company settings');
    }
  }
);

authAndAdminRouter.post(
  '/benchmark/reset',
  requireAuth,
  requireRole('OWNER'),
  async (req: AuthRequest, res) => {
    try {
      await seedBenchmarkScenario(true);
      await recordAuditLog(db, {
        user: req.user,
        action: 'BENCHMARK_RESET',
        entity: 'System',
        referenceId: 'BENCHMARK-SEED',
        newValue: { status: 'Reset to mandatory Murukku 200 g benchmark scenario' },
      });
      res.json({ ok: true, message: 'Benchmark scenario reloaded cleanly.' });
    } catch (error) {
      console.error('Benchmark reset failed:', error);
      return handleRouteError(res, error, 'Failed to reset benchmark data');
    }
  }
);

authAndAdminRouter.get(
  '/audit-logs',
  requireAuth,
  requireRole('OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'),
  async (req: AuthRequest, res) => {
    try {
      await ensureSeeded();
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const entityFilter = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
      const rows = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit);

      const filtered =
        entityFilter && entityFilter !== 'ALL'
          ? rows.filter((r) => r.entity.toLowerCase() === entityFilter.toLowerCase())
          : rows;

      res.json(filtered);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      return handleRouteError(res, error, 'Failed to load audit trail');
    }
  }
);
