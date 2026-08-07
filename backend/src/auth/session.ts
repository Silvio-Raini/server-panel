import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { env } from '../config/env.js';
import { getDb, type PanelUser, type SessionRow } from '../database/db.js';

const COOKIE_NAME = 'sp_session';

export function sessionCookieName(): string {
  return COOKIE_NAME;
}

export function createSession(userId: number, ip: string | null, userAgent: string | null): {
  sessionId: string;
  csrfToken: string;
  expiresAt: Date;
} {
  const sessionId = nanoid(48);
  const csrfToken = nanoid(32);
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE * 1000);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, userId, csrfToken, ip, userAgent, expiresAt.toISOString());
  return { sessionId, csrfToken, expiresAt };
}

export function destroySession(sessionId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function destroyAllUserSessions(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function getSession(sessionId: string): (SessionRow & { user: PanelUser }) | null {
  const row = getDb()
    .prepare(
      `SELECT s.*, u.id as uid, u.username, u.password_hash, u.role, u.totp_secret,
              u.totp_enabled, u.created_at as user_created_at, u.last_login_at, u.disabled
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | (SessionRow & {
        uid: number;
        username: string;
        password_hash: string;
        role: PanelUser['role'];
        totp_secret: string | null;
        totp_enabled: number;
        user_created_at: string;
        last_login_at: string | null;
        disabled: number;
      })
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  if (row.disabled) {
    destroySession(sessionId);
    return null;
  }

  getDb()
    .prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`)
    .run(sessionId);

  return {
    id: row.id,
    user_id: row.user_id,
    csrf_token: row.csrf_token,
    ip: row.ip,
    user_agent: row.user_agent,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    user: {
      id: row.uid,
      username: row.username,
      password_hash: row.password_hash,
      role: row.role,
      totp_secret: row.totp_secret,
      totp_enabled: row.totp_enabled,
      created_at: row.user_created_at,
      last_login_at: row.last_login_at,
      disabled: row.disabled,
    },
  };
}

export function signCsrf(token: string): string {
  return createHmac('sha256', env.CSRF_SECRET).update(token).digest('hex');
}

export function verifyCsrf(sessionToken: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = sessionToken;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cleanupExpiredSessions(): void {
  getDb().prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
}

export function newSecret(): string {
  return randomBytes(32).toString('hex');
}
