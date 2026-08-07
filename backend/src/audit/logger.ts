import { getDb } from '../database/db.js';

export interface AuditEntry {
  userId?: number | null;
  username?: string | null;
  action: string;
  target?: string | null;
  success: boolean;
  message?: string | null;
  ip?: string | null;
}

export function writeAudit(entry: AuditEntry): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (user_id, username, action, target, success, message, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.userId ?? null,
      entry.username ?? null,
      entry.action,
      entry.target ?? null,
      entry.success ? 1 : 0,
      entry.message ?? null,
      entry.ip ?? null,
    );
}

export function listAudit(limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, user_id, username, action, target, success, message, ip
       FROM audit_log
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(safeLimit, safeOffset);
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM audit_log`).get() as { c: number }).c;
  return { rows, total, limit: safeLimit, offset: safeOffset };
}
