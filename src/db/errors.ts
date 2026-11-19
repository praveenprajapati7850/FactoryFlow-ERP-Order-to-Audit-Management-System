import type { Response } from 'express';

const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '28P01', // invalid_password
]);

/**
 * Classifies PostgreSQL connectivity / service unavailability errors without leaking raw internals.
 */
export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code && DB_UNAVAILABLE_CODES.has(String(e.code))) {
    return true;
  }
  const msg = String(e.message || '').toLowerCase();
  if (
    msg.includes('econnrefused') ||
    msg.includes('connection terminated') ||
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('the database system is starting up') ||
    msg.includes('cannot connect') ||
    msg.includes('enoent') && msg.includes('.s.pgsql')
  ) {
    return true;
  }
  if (e.cause && e.cause !== err) {
    return isDatabaseUnavailableError(e.cause);
  }
  return false;
}

export function isUniqueViolationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; cause?: unknown };
  if (e.code === '23505') return true;
  if (e.cause && e.cause !== err) return isUniqueViolationError(e.cause);
  return false;
}

export function handleRouteError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
  defaultStatus = 500
) {
  if (isDatabaseUnavailableError(error)) {
    console.error(`${fallbackMessage} (Database unavailable):`, error);
    return res.status(503).json({
      error: 'Database is currently unavailable. Please verify PostgreSQL connectivity and try again.',
    });
  }
  if (isUniqueViolationError(error)) {
    return res.status(409).json({
      error: `${fallbackMessage}: A record with that unique identifier already exists.`,
    });
  }
  console.error(`${fallbackMessage}:`, error);
  if (defaultStatus === 400 && error instanceof Error && error.message) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(defaultStatus).json({ error: fallbackMessage });
}
