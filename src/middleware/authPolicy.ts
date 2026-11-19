import crypto from 'node:crypto';

/**
 * Pure authentication, JWT secret validation, CSRF/Origin protection, and RBAC policy helpers.
 * Decoupled from database and Firebase I/O for deterministic unit testing.
 */

export type OperationalRoleCode =
  | 'OWNER'
  | 'ADMIN'
  | 'PRODUCTION_SUPERVISOR'
  | 'SALESMAN'
  | 'AUDITOR';

export type RoleCode = OperationalRoleCode | 'PENDING';

export const OPERATIONAL_ROLES: ReadonlyArray<OperationalRoleCode> = [
  'OWNER',
  'ADMIN',
  'PRODUCTION_SUPERVISOR',
  'SALESMAN',
  'AUDITOR',
];

const WEAK_SECRET_PATTERNS = [
  'changeme',
  'change_me',
  'secret',
  'password',
  'factoryflow-erp-internal',
  'replace-with',
  'replace_with',
  'your-secret',
  'your_secret',
  'my-jwt-secret',
  'default',
  '123456',
];

export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Strictly validates JWT_SECRET from server environment variables.
 * Never falls back to a hardcoded string; throws if missing, too short, or weak.
 */
export function validateJwtSecret(secret: string | undefined): string {
  const trimmed = (secret ?? '').trim();
  if (!trimmed) {
    throw new Error(
      'FATAL SECURITY ERROR: JWT_SECRET environment variable is required and must be set to a strong random value (>= 32 characters).'
    );
  }
  if (trimmed.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `FATAL SECURITY ERROR: JWT_SECRET is too weak (${trimmed.length} chars). It must be at least ${MIN_JWT_SECRET_LENGTH} characters long.`
    );
  }
  const lower = trimmed.toLowerCase();
  if (WEAK_SECRET_PATTERNS.some((pattern) => lower.includes(pattern))) {
    throw new Error(
      'FATAL SECURITY ERROR: JWT_SECRET appears to be a placeholder or weak secret. Generate a cryptographically random secret (e.g., `openssl rand -hex 32`).'
    );
  }
  // Reject low-entropy repeated characters (e.g. "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  if (new Set(trimmed).size < 8) {
    throw new Error(
      'FATAL SECURITY ERROR: JWT_SECRET has insufficient character entropy. Use a cryptographically random value.'
    );
  }
  return trimmed;
}

export interface AuthCheckResult {
  allowed: boolean;
  status: number;
  code?: 'PENDING_APPROVAL' | 'ACCOUNT_INACTIVE';
  error?: string;
}

/**
 * Verifies a user account is active and has been assigned an operational role (not PENDING).
 */
export function assertActiveAuthorizedUser(user: {
  isActive: boolean;
  roleCode: string;
}): AuthCheckResult {
  if (user.roleCode === 'PENDING') {
    return {
      allowed: false,
      status: 403,
      code: 'PENDING_APPROVAL',
      error:
        'Your account is registered and awaiting administrator approval and role assignment before you can access FactoryFlow ERP.',
    };
  }
  if (!user.isActive) {
    return {
      allowed: false,
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      error: 'Your user account has been deactivated. Contact an Owner or Admin to reactivate access.',
    };
  }
  return { allowed: true, status: 200 };
}

/**
 * Checks whether an actor role is authorized to assign a target role and active status.
 */
export function canAssignRole(params: {
  actorRole: RoleCode;
  targetRole: RoleCode;
  targetIsActive: boolean;
}): { allowed: boolean; error?: string } {
  if (!['OWNER', 'ADMIN'].includes(params.actorRole)) {
    return { allowed: false, error: 'Only Owner or Admin can manage user roles and activation.' };
  }
  if (params.targetRole === 'OWNER' && params.actorRole !== 'OWNER') {
    return { allowed: false, error: 'Only an Owner can assign the OWNER role.' };
  }
  if (params.targetRole === 'PENDING' && params.targetIsActive) {
    return {
      allowed: false,
      error: 'Assign an operational role (Salesman, Production Supervisor, Auditor, Admin, or Owner) before activating a pending user.',
    };
  }
  return { allowed: true };
}

export const SESSION_COOKIE_NAME = 'factoryflow_session';
export const CSRF_COOKIE_NAME = 'factoryflow_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours (matches JWT exp)

export type CookieSameSite = 'Lax' | 'Strict' | 'None';

/**
 * Parses an HTTP Cookie header string into a key/value map.
 */
export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const rawVal = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

function getHeaderSingle(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (typeof val === 'string') return val.split(',')[0].trim();
  if (Array.isArray(val) && val.length > 0) return val[0].split(',')[0].trim();
  return undefined;
}

function isCloudRunHttpsHost(host: string | undefined): boolean {
  const clean = (host || '').trim().toLowerCase().replace(/:\d+$/, '');
  return clean.endsWith('.run.app');
}

function matchesHttpsAppUrlHost(host: string | undefined, appUrl: string | undefined): boolean {
  if (!host || !appUrl) return false;
  try {
    const parsed = new URL(appUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    return parsed.host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Determines whether the client-facing request arrived over HTTPS.
 * Handles both direct TLS / Cloud Run LB (`X-Forwarded-Proto: https`) and double-proxied
 * containers (e.g., Cloud Run -> local nginx forwarding `X-Forwarded-Proto: http` with
 * `X-Forwarded-Host: *.run.app` or matching an `https://` APP_URL).
 */
export function isSecureRequest(
  reqLike: {
    secure?: boolean;
    headers?: Record<string, string | string[] | undefined>;
  },
  appUrl?: string
): boolean {
  if (reqLike.secure) return true;
  const proto = getHeaderSingle(reqLike.headers, 'x-forwarded-proto');
  if (proto && proto.toLowerCase() === 'https') {
    return true;
  }
  const forwardedHost = getHeaderSingle(reqLike.headers, 'x-forwarded-host');
  const host = getHeaderSingle(reqLike.headers, 'host');
  for (const candidate of [forwardedHost, host]) {
    if (isCloudRunHttpsHost(candidate) || matchesHttpsAppUrlHost(candidate, appUrl)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the appropriate SameSite directive:
 * - Non-HTTPS (local HTTP): always 'Lax' (browsers reject SameSite=None without Secure).
 * - Explicit COOKIE_SAME_SITE env ('strict' | 'lax' | 'none'): honored over HTTPS.
 * - Default over HTTPS: 'Lax' for standalone Cloud Run / custom domains;
 *   automatically uses 'None' only for AI Studio embedded preview iframe hosts (ais-dev-* / ais-pre-*),
 *   always paired with Secure + Partitioned + strict Origin + double-submit CSRF verification.
 */
export function resolveCookieSameSite(options: {
  isHttps: boolean;
  host?: string;
  envSameSite?: string;
}): CookieSameSite {
  if (!options.isHttps) return 'Lax';
  const normalizedEnv = (options.envSameSite || '').trim().toLowerCase();
  if (normalizedEnv === 'strict') return 'Strict';
  if (normalizedEnv === 'lax') return 'Lax';
  if (normalizedEnv === 'none') return 'None';

  const host = (options.host || '').trim().toLowerCase();
  if (/^ais-(dev|pre)-[a-z0-9.-]+\.run\.app(?::\d+)?$/i.test(host)) {
    return 'None';
  }
  return 'Lax';
}

function appendSecurityCookieAttributes(parts: string[], isHttps: boolean, sameSite: CookieSameSite): void {
  if (isHttps) {
    parts.push('Secure', `SameSite=${sameSite}`);
    if (sameSite === 'None') {
      parts.push('Partitioned');
    }
  } else {
    parts.push(`SameSite=${sameSite === 'None' ? 'Lax' : sameSite}`);
  }
}

/**
 * Builds an HttpOnly Set-Cookie header for server-managed JWT sessions.
 */
export function buildSessionCookieHeader(
  token: string,
  options: { isHttps: boolean; sameSite?: CookieSameSite; host?: string; envSameSite?: string; maxAgeSeconds?: number }
): string {
  const maxAge = options.maxAgeSeconds ?? SESSION_COOKIE_MAX_AGE_SECONDS;
  const sameSite = options.sameSite ?? resolveCookieSameSite(options);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAge}`,
  ];
  appendSecurityCookieAttributes(parts, options.isHttps, sameSite);
  return parts.join('; ');
}

/**
 * Builds an expiring Set-Cookie header to immediately clear the HttpOnly session cookie on logout.
 */
export function buildClearSessionCookieHeader(options: {
  isHttps: boolean;
  sameSite?: CookieSameSite;
  host?: string;
  envSameSite?: string;
}): string {
  const sameSite = options.sameSite ?? resolveCookieSameSite(options);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  appendSecurityCookieAttributes(parts, options.isHttps, sameSite);
  return parts.join('; ');
}

/**
 * Generates a cryptographically strong 256-bit CSRF token for double-submit cookie verification.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Builds a non-HttpOnly CSRF cookie header readable by same-origin frontend JS to echo in X-CSRF-Token.
 */
export function buildCsrfCookieHeader(
  csrfToken: string,
  options: { isHttps: boolean; sameSite?: CookieSameSite; host?: string; envSameSite?: string; maxAgeSeconds?: number }
): string {
  const maxAge = options.maxAgeSeconds ?? SESSION_COOKIE_MAX_AGE_SECONDS;
  const sameSite = options.sameSite ?? resolveCookieSameSite(options);
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  appendSecurityCookieAttributes(parts, options.isHttps, sameSite);
  return parts.join('; ');
}

export function buildClearCsrfCookieHeader(options: {
  isHttps: boolean;
  sameSite?: CookieSameSite;
  host?: string;
  envSameSite?: string;
}): string {
  const sameSite = options.sameSite ?? resolveCookieSameSite(options);
  const parts = [
    `${CSRF_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  appendSecurityCookieAttributes(parts, options.isHttps, sameSite);
  return parts.join('; ');
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Computes the strict set of trusted origins for the current request (same-origin Host/X-Forwarded-Host + APP_URL + ALLOWED_ORIGINS).
 */
export function getAllowedOrigins(params: {
  isHttps: boolean;
  host?: string;
  forwardedHost?: string;
  appUrl?: string;
  allowedOriginsEnv?: string;
}): Set<string> {
  const allowed = new Set<string>();
  const primaryProto = params.isHttps ? 'https' : 'http';

  for (const h of [params.forwardedHost, params.host]) {
    const cleanHost = (h || '').trim().toLowerCase();
    if (!cleanHost) continue;
    const primary = normalizeOrigin(`${primaryProto}://${cleanHost}`);
    if (primary) allowed.add(primary);
  }

  const normalizedAppUrl = normalizeOrigin(params.appUrl);
  if (normalizedAppUrl) allowed.add(normalizedAppUrl);

  if (params.allowedOriginsEnv) {
    for (const raw of params.allowedOriginsEnv.split(',')) {
      const normalized = normalizeOrigin(raw);
      if (normalized) allowed.add(normalized);
    }
  }

  return allowed;
}

/**
 * Constant-time comparison of the double-submit CSRF cookie and X-CSRF-Token header.
 */
export function validateDoubleSubmitCsrf(params: {
  cookieToken: string | undefined;
  headerToken: string | undefined;
}): boolean {
  const cookieVal = (params.cookieToken || '').trim();
  const headerVal = (params.headerToken || '').trim();
  if (cookieVal.length < 32 || headerVal.length < 32) return false;
  const a = Buffer.from(cookieVal, 'utf8');
  const b = Buffer.from(headerVal, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface CsrfCheckResult {
  allowed: boolean;
  status?: number;
  code?: 'INVALID_ORIGIN' | 'CSRF_TOKEN_INVALID';
  error?: string;
}

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces strict Origin/Referer validation on all state-changing API requests AND
 * double-submit CSRF token verification on all HttpOnly cookie-authenticated mutations.
 */
export function evaluateCsrfRequest(
  reqLike: {
    method: string;
    secure?: boolean;
    headers?: Record<string, string | string[] | undefined>;
  },
  env: { APP_URL?: string; ALLOWED_ORIGINS?: string } = {}
): CsrfCheckResult {
  const method = (reqLike.method || 'GET').toUpperCase();
  if (SAFE_HTTP_METHODS.has(method)) {
    return { allowed: true };
  }

  const isHttps = isSecureRequest(reqLike, env.APP_URL);
  const host = getHeaderSingle(reqLike.headers, 'host');
  const forwardedHost = getHeaderSingle(reqLike.headers, 'x-forwarded-host');
  const allowedOrigins = getAllowedOrigins({
    isHttps,
    host,
    forwardedHost,
    appUrl: env.APP_URL,
    allowedOriginsEnv: env.ALLOWED_ORIGINS,
  });

  // 1. Strict Origin / Referer check whenever either header is present (blocks cross-origin POST/PUT/PATCH/DELETE & login CSRF)
  const rawOrigin = getHeaderSingle(reqLike.headers, 'origin');
  const rawReferer = getHeaderSingle(reqLike.headers, 'referer');

  if (rawOrigin !== undefined) {
    // Reject "Origin: null" (sandboxed iframes / data: URLs) and any untrusted origin
    const normalizedOrigin = normalizeOrigin(rawOrigin);
    if (!normalizedOrigin || !allowedOrigins.has(normalizedOrigin)) {
      return {
        allowed: false,
        status: 403,
        code: 'INVALID_ORIGIN',
        error: 'Forbidden: Cross-origin state-changing request rejected',
      };
    }
  } else if (rawReferer !== undefined) {
    const normalizedReferer = normalizeOrigin(rawReferer);
    if (!normalizedReferer || !allowedOrigins.has(normalizedReferer)) {
      return {
        allowed: false,
        status: 403,
        code: 'INVALID_ORIGIN',
        error: 'Forbidden: Cross-origin referer rejected',
      };
    }
  }

  // 2. Pure Authorization: Bearer requests are not auto-attached by browsers -> exempt from CSRF cookie check
  const authHeader = getHeaderSingle(reqLike.headers, 'authorization');
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice('Bearer '.length).trim().length > 0) {
    return { allowed: true };
  }

  // 3. Any state-changing request carrying the HttpOnly session cookie MUST present a matching X-CSRF-Token header
  const cookies = parseCookieHeader(getHeaderSingle(reqLike.headers, 'cookie'));
  const hasSessionCookie = Boolean(cookies[SESSION_COOKIE_NAME] && cookies[SESSION_COOKIE_NAME].trim().length > 0);
  if (hasSessionCookie) {
    const headerToken = getHeaderSingle(reqLike.headers, CSRF_HEADER_NAME);
    const validCsrf = validateDoubleSubmitCsrf({
      cookieToken: cookies[CSRF_COOKIE_NAME],
      headerToken,
    });
    if (!validCsrf) {
      return {
        allowed: false,
        status: 403,
        code: 'CSRF_TOKEN_INVALID',
        error: 'Forbidden: Missing or invalid CSRF token',
      };
    }
  }

  return { allowed: true };
}


