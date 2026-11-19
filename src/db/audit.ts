import crypto from 'node:crypto';
import { db } from './index.ts';
import { auditLogs } from './schema.ts';
import type { AuthUser } from '../middleware/auth.ts';

type DbLike = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export function generateTxnId(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

export async function recordAuditLog(
  executor: DbLike,
  params: {
    user?: { id: number; name: string; roleCode: string } | null;
    action: string;
    entity: string;
    referenceId: string;
    previousValue?: unknown;
    newValue?: unknown;
  }
) {
  await executor.insert(auditLogs).values({
    userId: params.user?.id ?? null,
    userName: params.user?.name ?? 'System',
    userRole: params.user?.roleCode ?? 'SYSTEM',
    action: params.action,
    entity: params.entity,
    referenceId: params.referenceId,
    previousValue: params.previousValue !== undefined ? JSON.stringify(params.previousValue) : null,
    newValue: params.newValue !== undefined ? JSON.stringify(params.newValue) : null,
  });
}
