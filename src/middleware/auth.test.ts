import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  validateJwtSecret,
  assertActiveAuthorizedUser,
  canAssignRole,
  OperationalRoleCode,
  RoleCode,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  parseCookieHeader,
  isSecureRequest,
  resolveCookieSameSite,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  generateCsrfToken,
  buildCsrfCookieHeader,
  validateDoubleSubmitCsrf,
  evaluateCsrfRequest,
} from './authPolicy.ts';
import {
  requireRole,
  extractRequestToken,
  signSessionToken,
  verifySessionToken,
  revokeSessionToken,
  AuthRequest,
} from './auth.ts';
import type { Response, NextFunction } from 'express';

const STRONG_TEST_SECRET = '9f4a8e2c7b1d6034a5e9c2f87140b6d3e9a2c4f180b7d5e3a1c6f904b2d8e7a5';

function createMockRes() {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body as Record<string, unknown> | null,
  };
}

test('JWT secret validation fails securely when missing, short, placeholder, or low-entropy', () => {
  assert.throws(() => validateJwtSecret(undefined), /JWT_SECRET environment variable is required/);
  assert.throws(() => validateJwtSecret(''), /JWT_SECRET environment variable is required/);
  assert.throws(() => validateJwtSecret('short-key'), /too weak/);
  assert.throws(
    () => validateJwtSecret('factoryflow-erp-internal-jwt-secret-key-2026'),
    /placeholder or weak secret/
  );
  assert.throws(
    () => validateJwtSecret('REPLACE_WITH_64_CHAR_HEX_FROM_OPENSSL_RAND_HEX_32'),
    /placeholder or weak secret/
  );
  assert.throws(
    () => validateJwtSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    /insufficient character entropy/
  );

  // Strong 64-char hex secret succeeds and supports round-trip signing/verification
  const validated = validateJwtSecret(STRONG_TEST_SECRET);
  assert.equal(validated, STRONG_TEST_SECRET);
  const token = jwt.sign({ userId: 1, roleCode: 'OWNER' }, validated, { expiresIn: '1h' });
  const decoded = jwt.verify(token, validated) as { userId: number; roleCode: string };
  assert.equal(decoded.userId, 1);
  assert.equal(decoded.roleCode, 'OWNER');
});

test('pending and inactive users are always blocked from authentication', () => {
  // Brand-new Google user registered as PENDING + inactive
  const pendingCheck = assertActiveAuthorizedUser({ isActive: false, roleCode: 'PENDING' });
  assert.equal(pendingCheck.allowed, false);
  assert.equal(pendingCheck.status, 403);
  assert.equal(pendingCheck.code, 'PENDING_APPROVAL');

  // Even if isActive were somehow flipped true, PENDING role is still blocked
  const pendingActiveCheck = assertActiveAuthorizedUser({ isActive: true, roleCode: 'PENDING' });
  assert.equal(pendingActiveCheck.allowed, false);
  assert.equal(pendingActiveCheck.status, 403);

  // Deactivated operational user is blocked
  const inactiveCheck = assertActiveAuthorizedUser({ isActive: false, roleCode: 'ADMIN' });
  assert.equal(inactiveCheck.allowed, false);
  assert.equal(inactiveCheck.status, 403);
  assert.equal(inactiveCheck.code, 'ACCOUNT_INACTIVE');

  // Active operational user is permitted
  const activeCheck = assertActiveAuthorizedUser({ isActive: true, roleCode: 'SALESMAN' });
  assert.equal(activeCheck.allowed, true);
  assert.equal(activeCheck.status, 200);
});

test('role assignment policy enforces strict privilege boundaries', () => {
  // Non-admins cannot assign roles
  assert.equal(
    canAssignRole({ actorRole: 'SALESMAN', targetRole: 'ADMIN', targetIsActive: true }).allowed,
    false
  );
  assert.equal(
    canAssignRole({ actorRole: 'AUDITOR', targetRole: 'SALESMAN', targetIsActive: true }).allowed,
    false
  );
  assert.equal(
    canAssignRole({
      actorRole: 'PRODUCTION_SUPERVISOR',
      targetRole: 'SALESMAN',
      targetIsActive: true,
    }).allowed,
    false
  );

  // ADMIN cannot escalate anyone to OWNER
  assert.equal(
    canAssignRole({ actorRole: 'ADMIN', targetRole: 'OWNER', targetIsActive: true }).allowed,
    false
  );
  // ADMIN can approve a pending user into SALESMAN / PRODUCTION_SUPERVISOR / AUDITOR / ADMIN
  assert.equal(
    canAssignRole({ actorRole: 'ADMIN', targetRole: 'SALESMAN', targetIsActive: true }).allowed,
    true
  );
  // OWNER can assign OWNER
  assert.equal(
    canAssignRole({ actorRole: 'OWNER', targetRole: 'OWNER', targetIsActive: true }).allowed,
    true
  );
  // Cannot activate a user while still in PENDING role
  assert.equal(
    canAssignRole({ actorRole: 'OWNER', targetRole: 'PENDING', targetIsActive: true }).allowed,
    false
  );
});

test('requireRole middleware enforces RBAC across all ERP roles and blocks inactive/pending accounts', () => {
  const invokeRoleGuard = (
    allowedRoles: OperationalRoleCode[],
    user?: { roleCode: RoleCode; isActive: boolean }
  ) => {
    const middleware = requireRole(...allowedRoles);
    const req = {
      user: user
        ? {
            id: 10,
            uid: 'u-10',
            email: 'test@factoryflow.in',
            name: 'Test User',
            roleId: 1,
            roleCode: user.roleCode,
            phone: '',
            isActive: user.isActive,
          }
        : undefined,
    } as AuthRequest;
    const mock = createMockRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };
    middleware(req, mock.res, next);
    return { nextCalled, status: mock.getStatus(), body: mock.getBody() };
  };

  // Unauthenticated -> 401
  assert.equal(invokeRoleGuard(['OWNER']).status, 401);

  // Auditor attempting Admin/Owner mutation -> 403
  const auditorWrite = invokeRoleGuard(['OWNER', 'ADMIN'], { roleCode: 'AUDITOR', isActive: true });
  assert.equal(auditorWrite.nextCalled, false);
  assert.equal(auditorWrite.status, 403);

  // Salesman attempting User Management / Payments -> 403
  const salesmanUsers = invokeRoleGuard(['OWNER', 'ADMIN', 'AUDITOR'], {
    roleCode: 'SALESMAN',
    isActive: true,
  });
  assert.equal(salesmanUsers.nextCalled, false);
  assert.equal(salesmanUsers.status, 403);

  // Inactive Owner -> 403
  const inactiveOwner = invokeRoleGuard(['OWNER'], { roleCode: 'OWNER', isActive: false });
  assert.equal(inactiveOwner.nextCalled, false);
  assert.equal(inactiveOwner.status, 403);

  // Pending user -> 403
  const pendingUser = invokeRoleGuard(['SALESMAN', 'OWNER'], {
    roleCode: 'PENDING',
    isActive: false,
  });
  assert.equal(pendingUser.nextCalled, false);
  assert.equal(pendingUser.status, 403);

  // Authorized Production Supervisor -> passes
  const supervisorProd = invokeRoleGuard(['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'], {
    roleCode: 'PRODUCTION_SUPERVISOR',
    isActive: true,
  });
  assert.equal(supervisorProd.nextCalled, true);
});

test('HttpOnly session cookie helpers enforce Secure + appropriate SameSite across Cloud Run, iframe, and localhost', () => {
  // Standalone Cloud Run HTTPS defaults to Secure + SameSite=Lax + HttpOnly
  const standaloneHttpsCookie = buildSessionCookieHeader('jwt.token.val', {
    isHttps: true,
    host: 'factoryflow-erp-prod.asia-southeast1.run.app',
  });
  assert.match(standaloneHttpsCookie, new RegExp(`^${SESSION_COOKIE_NAME}=jwt\\.token\\.val`));
  assert.match(standaloneHttpsCookie, /HttpOnly/);
  assert.match(standaloneHttpsCookie, /Secure/);
  assert.match(standaloneHttpsCookie, /SameSite=Lax/);
  assert.match(standaloneHttpsCookie, /Path=\//);

  // AI Studio embedded preview iframe host uses Secure + SameSite=None + Partitioned (paired with Origin + CSRF token checks)
  const previewIframeCookie = buildSessionCookieHeader('jwt.token.val', {
    isHttps: true,
    host: 'ais-dev-abc123.asia-southeast1.run.app',
  });
  assert.match(previewIframeCookie, /HttpOnly/);
  assert.match(previewIframeCookie, /Secure/);
  assert.match(previewIframeCookie, /SameSite=None/);
  assert.match(previewIframeCookie, /Partitioned/);

  // Explicit COOKIE_SAME_SITE=strict override on HTTPS
  assert.equal(
    resolveCookieSameSite({ isHttps: true, host: 'erp.factoryflow.in', envSameSite: 'strict' }),
    'Strict'
  );

  // Local plain HTTP uses HttpOnly + SameSite=Lax (no Secure flag so localhost works)
  const httpCookie = buildSessionCookieHeader('jwt.token.val', { isHttps: false });
  assert.match(httpCookie, /HttpOnly/);
  assert.match(httpCookie, /SameSite=Lax/);
  assert.doesNotMatch(httpCookie, /; Secure/);

  // Clear cookie expires immediately with matching attributes
  const clearHttps = buildClearSessionCookieHeader({
    isHttps: true,
    host: 'factoryflow-erp-prod.asia-southeast1.run.app',
  });
  assert.match(clearHttps, /Max-Age=0/);
  assert.match(clearHttps, /HttpOnly/);
  assert.match(clearHttps, /Secure/);
  assert.match(clearHttps, /SameSite=Lax/);

  // CSRF cookie is intentionally readable by same-origin JS (not HttpOnly) and Secure on HTTPS
  const csrfToken = generateCsrfToken();
  assert.equal(csrfToken.length, 64);
  const csrfCookie = buildCsrfCookieHeader(csrfToken, { isHttps: true, host: 'erp.factoryflow.in' });
  assert.match(csrfCookie, new RegExp(`^${CSRF_COOKIE_NAME}=`));
  assert.doesNotMatch(csrfCookie, /HttpOnly/);
  assert.match(csrfCookie, /Secure/);
  assert.match(csrfCookie, /SameSite=Lax/);

  // Proxy protocol detection behind Google Cloud Run load balancer & container nginx double-proxy
  assert.equal(isSecureRequest({ secure: true, headers: {} }), true);
  assert.equal(isSecureRequest({ secure: false, headers: { 'x-forwarded-proto': 'https, http' } }), true);
  assert.equal(isSecureRequest({ secure: false, headers: { 'x-forwarded-proto': 'http', host: 'localhost:3000' } }), false);
  assert.equal(
    isSecureRequest({
      secure: false,
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'ais-pre-abc123.asia-southeast1.run.app',
        'x-forwarded-proto': 'http',
      },
    }),
    true
  );

  // Cookie parsing & token extraction precedence (Bearer > HttpOnly Cookie)
  const parsed = parseCookieHeader(`theme=dark; ${SESSION_COOKIE_NAME}=cookie-jwt-123; foo=bar`);
  assert.equal(parsed[SESSION_COOKIE_NAME], 'cookie-jwt-123');
  assert.equal(
    extractRequestToken({
      headers: { cookie: `${SESSION_COOKIE_NAME}=cookie-jwt-123` },
    } as AuthRequest),
    'cookie-jwt-123'
  );
  assert.equal(
    extractRequestToken({
      headers: {
        authorization: 'Bearer bearer-jwt-456',
        cookie: `${SESSION_COOKIE_NAME}=cookie-jwt-123`,
      },
    } as AuthRequest),
    'bearer-jwt-456'
  );
  assert.equal(extractRequestToken({ headers: {} } as AuthRequest), null);
});

test('CSRF double-submit and strict Origin/Referer policy blocks cross-site mutations and handles Cloud Run double-proxy', () => {
  const csrfToken = generateCsrfToken();
  const wrongToken = generateCsrfToken();

  assert.equal(validateDoubleSubmitCsrf({ cookieToken: csrfToken, headerToken: csrfToken }), true);
  assert.equal(validateDoubleSubmitCsrf({ cookieToken: csrfToken, headerToken: wrongToken }), false);
  assert.equal(validateDoubleSubmitCsrf({ cookieToken: csrfToken, headerToken: '' }), false);
  assert.equal(validateDoubleSubmitCsrf({ cookieToken: 'short', headerToken: 'short' }), false);

  // Safe GET requests pass
  assert.equal(
    evaluateCsrfRequest({
      method: 'GET',
      headers: { host: 'erp.factoryflow.in', origin: 'https://evil.example' },
    }).allowed,
    true
  );

  // Cross-origin POST is rejected with 403 INVALID_ORIGIN even with valid CSRF token
  const crossOrigin = evaluateCsrfRequest({
    method: 'POST',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      origin: 'https://evil.example',
      cookie: `${SESSION_COOKIE_NAME}=sess123; ${CSRF_COOKIE_NAME}=${csrfToken}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
  });
  assert.equal(crossOrigin.allowed, false);
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.code, 'INVALID_ORIGIN');

  // "Origin: null" (sandboxed iframe / data URL) is rejected
  const nullOrigin = evaluateCsrfRequest({
    method: 'POST',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      origin: 'null',
    },
  });
  assert.equal(nullOrigin.allowed, false);
  assert.equal(nullOrigin.code, 'INVALID_ORIGIN');

  // Cross-origin Referer without Origin header is rejected
  const crossReferer = evaluateCsrfRequest({
    method: 'DELETE',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      referer: 'https://attacker.example/csrf.html',
      cookie: `${SESSION_COOKIE_NAME}=sess123; ${CSRF_COOKIE_NAME}=${csrfToken}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
  });
  assert.equal(crossReferer.allowed, false);
  assert.equal(crossReferer.code, 'INVALID_ORIGIN');

  // Same-origin cookie-authenticated POST missing X-CSRF-Token is rejected
  const missingCsrf = evaluateCsrfRequest({
    method: 'POST',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      origin: 'https://erp.factoryflow.in',
      cookie: `${SESSION_COOKIE_NAME}=sess123; ${CSRF_COOKIE_NAME}=${csrfToken}`,
    },
  });
  assert.equal(missingCsrf.allowed, false);
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.code, 'CSRF_TOKEN_INVALID');

  // Same-origin cookie-authenticated POST with matching X-CSRF-Token passes
  const validMutation = evaluateCsrfRequest({
    method: 'PATCH',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      origin: 'https://erp.factoryflow.in',
      cookie: `${SESSION_COOKIE_NAME}=sess123; ${CSRF_COOKIE_NAME}=${csrfToken}`,
      [CSRF_HEADER_NAME]: csrfToken,
    },
  });
  assert.equal(validMutation.allowed, true);

  // Double-proxied Cloud Run shared preview (nginx forwards Host: localhost:3000, X-Forwarded-Proto: http, X-Forwarded-Host: ais-pre-*.run.app)
  const doubleProxiedSharedOrigin = evaluateCsrfRequest(
    {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'ais-pre-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app',
        'x-forwarded-proto': 'http',
        origin: 'https://ais-pre-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app',
      },
    },
    { APP_URL: 'https://ais-dev-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app' }
  );
  assert.equal(doubleProxiedSharedOrigin.allowed, true);

  // Cross-origin request to the same double-proxied Cloud Run preview is STILL blocked
  const doubleProxiedEvilOrigin = evaluateCsrfRequest(
    {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'ais-pre-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app',
        'x-forwarded-proto': 'http',
        origin: 'https://evil-phish.example',
      },
    },
    { APP_URL: 'https://ais-dev-jg46isrdovhwiocquudg6t-807849025208.asia-southeast1.run.app' }
  );
  assert.equal(doubleProxiedEvilOrigin.allowed, false);
  assert.equal(doubleProxiedEvilOrigin.code, 'INVALID_ORIGIN');

  // Explicit ALLOWED_ORIGINS entry is accepted when CSRF token matches
  const allowedConfiguredOrigin = evaluateCsrfRequest(
    {
      method: 'POST',
      headers: {
        host: 'internal-service:3000',
        'x-forwarded-proto': 'https',
        origin: 'https://custom-erp.factoryflow.in',
        cookie: `${SESSION_COOKIE_NAME}=sess123; ${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: csrfToken,
      },
    },
    { ALLOWED_ORIGINS: 'https://custom-erp.factoryflow.in' }
  );
  assert.equal(allowedConfiguredOrigin.allowed, true);

  // Pure Authorization: Bearer API call passes without CSRF cookie when Origin is same-origin
  const bearerMutation = evaluateCsrfRequest({
    method: 'POST',
    headers: {
      host: 'erp.factoryflow.in',
      'x-forwarded-proto': 'https',
      origin: 'https://erp.factoryflow.in',
      authorization: 'Bearer api-token-123',
    },
  });
  assert.equal(bearerMutation.allowed, true);
});

test('server-side logout token revocation immediately invalidates replayed session JWTs', () => {
  const prevSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = STRONG_TEST_SECRET;
  try {
    const token = signSessionToken({
      id: 42,
      uid: 'u-42',
      email: 'owner@factoryflow.in',
      name: 'Owner',
      roleId: 1,
      roleCode: 'OWNER',
      phone: '',
      isActive: true,
    });
    const verified = verifySessionToken(token);
    assert.equal(verified.id, 42);
    assert.ok(verified.jti, 'Signed session JWT must include a unique jti claim');

    revokeSessionToken(token);
    assert.throws(() => verifySessionToken(token), /revoked/);
  } finally {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  }
});
