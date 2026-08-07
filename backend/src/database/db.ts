import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { hashPassword } from '../auth/password.js';

export type Role = 'admin' | 'readonly';

export interface PanelUser {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  totp_secret: string | null;
  totp_enabled: number;
  created_at: string;
  last_login_at: string | null;
  disabled: number;
}

export interface SessionRow {
  id: string;
  user_id: number;
  csrf_token: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export async function initDatabase(): Promise<Database.Database> {
  fs.mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });
  db = new Database(env.DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','readonly')),
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      disabled INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      target TEXT,
      success INTEGER NOT NULL,
      message TEXT,
      ip TEXT
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
      type TEXT NOT NULL CHECK(type IN ('static','proxy','redirect')),
      target TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      ssl_enabled INTEGER NOT NULL DEFAULT 0,
      ssl_status TEXT NOT NULL DEFAULT 'none',
      ssl_error TEXT,
      auto_ssl INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      notes TEXT,
      nginx_config TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
  `);

  await bootstrapAdmin();
  return db;
}

async function bootstrapAdmin(): Promise<void> {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return;
  const passwordHash = await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD);
  db.prepare(
    `INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`,
  ).run(env.BOOTSTRAP_ADMIN_USER, passwordHash);
  console.log(`[bootstrap] Admin-Benutzer "${env.BOOTSTRAP_ADMIN_USER}" angelegt. Bitte Passwort ändern.`);
}
