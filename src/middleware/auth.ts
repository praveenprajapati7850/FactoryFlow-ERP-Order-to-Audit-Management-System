import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users, roles } from '../db/schema.ts';
import { recordAuditLog } from '../db/audit.ts';
import { isDatabaseUnavailableError } from '../db/errors.ts';
import {
  RoleCode,
  OperationalRoleCode,
  validateJwtSecret,
  assertActiveAuthorizedUser,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  parseCookieHeader,
  isSecureRequest,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  generateCsrfToken,
  buildCsrfCookieHeader,
  buildClearCsrfCookieHeader,
  evaluateCsrfRequest,
} from './authPolicy.ts';

export type { RoleCode, OperationalRoleCode };
export { validateJwtSecret, assertActiveAuthorizedUser, SESSION_COOKIE_NAME, CSRF_COOKIE_NAME };

// Tracks revoked JWT IDs (jti -> expiryMs) for immediate logout invalidation within the active server instance
const revokedTokenJtis = new Map<string, number>();

function pruneRevokedTokens(nowMs = Date.now()): void {
  if (revokedTokenJtis.size < 64) return;
  for (const [jti, expMs] of revokedTokenJtis.entries()) {
    if (expMs <= nowMs) {
      revokedTokenJtis.delete(jti);
    }
  }
}

export function revokeSessionToken(token: string): void {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { jti?: string; exp?: number };
    if (decoded?.jti) {
      pruneRevokedTokens();
      const expMs = decoded.exp ? decoded.exp * 1000 : Date.now() + 12 * 60 * 60 * 1000;
      revokedTokenJtis.set(decoded.jti, expMs);
    }
  } catch {
    // Token is already expired or invalid
  }
}

export function isSessionTokenRevoked(jti: string | undefined): boolean {
  if (!jti) return false;
  const expMs = revokedTokenJtis.get(jti);
  if (!expMs) return false;
  if (expMs <= Date.now()) {
    revokedTokenJtis.delete(jti);
    return false;
  }
  return true;
}

function getCookieContext(req: Request) {
  const isHttps = isSecureRequest(req, process.env.APP_URL);
  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : undefined;
  const host = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host : undefined);
  return {
    isHttps,
    host,
    envSameSite: process.env.COOKIE_SAME_SITE,
  };
}

export function setSessionCookie(req: Request, res: Response, token: string): string {
  const ctx = getCookieContext(req);
  const csrfToken = generateCsrfToken();
  res.append('Set-Cookie', buildSessionCookieHeader(token, ctx));
  res.append('Set-Cookie', buildCsrfCookieHeader(csrfToken, ctx));
  return csrfToken;
}

export function ensureCsrfCookie(req: Request, res: Response): string {
  const cookies = parseCookieHeader(req.headers.cookie);
  const existing = cookies[CSRF_COOKIE_NAME]?.trim();
  if (existing && existing.length >= 32) {
    return existing;
  }
  const ctx = getCookieContext(req);
  const csrfToken = generateCsrfToken();
  res.append('Set-Cookie', buildCsrfCookieHeader(csrfToken, ctx));
  return csrfToken;
}

export function clearSessionCookie(req: Request, res: Response): void {
  const ctx = getCookieContext(req);
  res.append('Set-Cookie', buildClearSessionCookieHeader(ctx));
  res.append('Set-Cookie', buildClearCsrfCookieHeader(ctx));
}

export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const check = evaluateCsrfRequest(req, {
    APP_URL: process.env.APP_URL,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  });
  if (!check.allowed) {
    const cookies = parseCookieHeader(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);
    let refererOrigin: string | null = null;
    if (typeof req.headers.referer === 'string') {
      try {
        refererOrigin = new URL(req.headers.referer).origin;
      } catch {
        refererOrigin = 'invalid';
      }
    }
    console.warn(
      '[FactoryFlow Security] Rejected state-changing request:',
      JSON.stringify({
        method: req.method,
        path: req.path,
        code: check.code || 'CSRF_TOKEN_INVALID',
        origin: req.headers.origin || null,
        refererOrigin,
        host: req.headers.host || null,
        forwardedHost: req.headers['x-forwarded-host'] || null,
        forwardedProto: req.headers['x-forwarded-proto'] || null,
        hasSessionCookie: Boolean(cookies[SESSION_COOKIE_NAME]),
        hasCsrfCookie: Boolean(cookies[CSRF_COOKIE_NAME]),
        hasCsrfHeader: Boolean(req.headers['x-csrf-token']),
      })
    );
    return res.status(check.status || 403).json({
      error: check.error || 'Forbidden: CSRF validation failed',
      code: check.code || 'CSRF_TOKEN_INVALID',
    });
  }
  return next();
}

export function extractRequestToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  return cookieToken && cookieToken.trim().length > 0 ? cookieToken.trim() : null;
}

export interface AuthUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  roleId: number;
  roleCode: RoleCode;
  phone: string;
  isActive: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function getJwtSecret(): string {
  return validateJwtSecret(process.env.JWT_SECRET);
}

export function signSessionToken(user: AuthUser): string {
  const check = assertActiveAuthorizedUser(user);
  if (!check.allowed) {
    throw new Error(check.error || 'User account is not authorized to receive a session token');
  }
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.uid,
      jti: crypto.randomUUID(),
      id: user.id,
      email: user.email,
      roleCode: user.roleCode,
    },
    secret,
    { expiresIn: '12h' }
  );
}

export function verifySessionToken(token: string): { sub?: string; jti?: string; id?: number; roleCode?: string } {
  const secret = getJwtSecret();
  const payload = jwt.verify(token, secret) as { sub?: string; jti?: string; id?: number; roleCode?: string };
  if (isSessionTokenRevoked(payload.jti)) {
    throw new Error('Session token has been revoked');
  }
  return payload;
}

/**
 * Links an authenticated Firebase Google user to PostgreSQL.
 * SECURITY: Brand-new Google users are NEVER granted OWNER or any operational role automatically.
 * They are registered in a locked PENDING state (`roleCode: 'PENDING'`, `isActive: false`)
 * until an authorized Owner or Admin assigns a role and activates the account.
 */
export async function getOrCreateFirebaseUser(
  uid: string,
  email: string,
  name?: string,
  emailVerified = false
): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();

  // 1. Lookup by Firebase UID
  const existing = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
  if (existing.length > 0) {
    const u = existing[0];
    return {
      id: u.id,
      uid: u.uid,
      email: u.email,
      name: u.name,
      roleId: u.roleId,
      roleCode: u.roleCode as RoleCode,
      phone: u.phone || '',
      isActive: u.isActive,
    };
  }

  // 2. If verified email already exists in ERP user directory (pre-provisioned by Admin/Owner), link UID
  if (emailVerified && normalizedEmail) {
    const byEmail = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (byEmail.length > 0) {
      const u = byEmail[0];
      return {
        id: u.id,
        uid: u.uid,
        email: u.email,
        name: u.name,
        roleId: u.roleId,
        roleCode: u.roleCode as RoleCode,
        phone: u.phone || '',
        isActive: u.isActive,
      };
    }
  }

  // 3. New external Google user -> register strictly as PENDING & inactive
  let pendingRole = await db.select().from(roles).where(eq(roles.code, 'PENDING')).limit(1);
  if (pendingRole.length === 0) {
    pendingRole = await db
      .insert(roles)
      .values({
        code: 'PENDING',
        name: 'Pending Approval',
        description: 'Awaiting Owner or Admin role assignment and account activation',
        permissionsJson: JSON.stringify([]),
      })
      .onConflictDoNothing()
      .returning();
    if (pendingRole.length === 0) {
      pendingRole = await db.select().from(roles).where(eq(roles.code, 'PENDING')).limit(1);
    }
  }

  const displayName = (name || normalizedEmail.split('@')[0] || 'Pending User').trim();

  const inserted = await db
    .insert(users)
    .values({
      uid,
      email: normalizedEmail,
      name: displayName,
      roleId: pendingRole[0].id,
      roleCode: 'PENDING',
      phone: '',
      isActive: false,
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: { email: normalizedEmail, name: displayName },
    })
    .returning();

  const u = inserted[0];

  await recordAuditLog(db, {
    user: { id: u.id, name: u.name, roleCode: 'PENDING' },
    action: 'USER_REGISTRATION_PENDING',
    entity: 'User',
    referenceId: u.email,
    newValue: {
      uid: u.uid,
      roleCode: 'PENDING',
      isActive: false,
      provider: 'FIREBASE_GOOGLE',
    },
  });

  return {
    id: u.id,
    uid: u.uid,
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    roleCode: u.roleCode as RoleCode,
    phone: u.phone || '',
    isActive: u.isActive,
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = extractRequestToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  // 1. Try local signed JWT first (ERP credential login)
  let jwtVerifiedPayload: { sub?: string; id?: number } | null = null;
  try {
    jwtVerifiedPayload = verifySessionToken(token);
  } catch (err) {
    // If JWT_SECRET itself is misconfigured, fail loudly with 500 instead of silently falling through
    if (err instanceof Error && err.message.startsWith('FATAL SECURITY ERROR')) {
      console.error(err.message);
      return res.status(500).json({ error: 'Authentication configuration error on server' });
    }
    // Otherwise token may be a Firebase ID token -> proceed to step 2
  }

  if (jwtVerifiedPayload && jwtVerifiedPayload.id) {
    try {
      const found = await db.select().from(users).where(eq(users.id, jwtVerifiedPayload.id)).limit(1);
      if (found.length === 0) {
        return res.status(401).json({ error: 'Unauthorized: User account not found' });
      }
      const u = found[0];
      const activeCheck = assertActiveAuthorizedUser({ isActive: u.isActive, roleCode: u.roleCode });
      if (!activeCheck.allowed) {
        return res.status(activeCheck.status).json({
          error: activeCheck.error,
          code: activeCheck.code,
        });
      }
      req.user = {
        id: u.id,
        uid: u.uid,
        email: u.email,
        name: u.name,
        roleId: u.roleId,
        roleCode: u.roleCode as RoleCode,
        phone: u.phone || '',
        isActive: u.isActive,
      };
      return next();
    } catch (err) {
      if (isDatabaseUnavailableError(err)) {
        console.error('Database unavailable during auth verification:', err);
        return res.status(503).json({
          error: 'Database is currently unavailable. Please verify PostgreSQL connectivity and try again.',
        });
      }
      console.error('Auth lookup error:', err);
      return res.status(500).json({ error: 'Authentication check failed' });
    }
  }

  // 2. Verify Firebase ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
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
      return res.status(activeCheck.status).json({
        error: activeCheck.error,
        code: activeCheck.code,
      });
    }
    req.user = dbUser;
    return next();
  } catch (err) {
    if (isDatabaseUnavailableError(err)) {
      console.error('Database unavailable during Firebase auth:', err);
      return res.status(503).json({
        error: 'Database is currently unavailable. Please verify PostgreSQL connectivity and try again.',
      });
    }
    console.error('Auth verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};

export const requireRole = (...allowedRoles: OperationalRoleCode[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const activeCheck = assertActiveAuthorizedUser({
      isActive: req.user.isActive,
      roleCode: req.user.roleCode,
    });
    if (!activeCheck.allowed) {
      return res.status(activeCheck.status).json({
        error: activeCheck.error,
        code: activeCheck.code,
      });
    }
    if (!allowedRoles.includes(req.user.roleCode as OperationalRoleCode)) {
      return res.status(403).json({
        error: `Forbidden: Role '${req.user.roleCode}' does not have permission for this action`,
      });
    }
    return next();
  };
};
