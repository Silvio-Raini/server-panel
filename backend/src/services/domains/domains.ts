import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../database/db.js';
import { env } from '../../config/env.js';
import { runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import {
  assertDomainName,
  assertProxyTarget,
  assertRedirectTarget,
  assertStaticRoot,
} from '../../utils/validate.js';

export type DomainType = 'static' | 'proxy' | 'redirect';
export type SslStatus = 'none' | 'pending' | 'active' | 'failed';

export interface DomainRecord {
  id: number;
  domain: string;
  type: DomainType;
  target: string;
  aliases: string[];
  enabled: boolean;
  ssl_enabled: boolean;
  ssl_status: SslStatus;
  ssl_error: string | null;
  auto_ssl: boolean;
  created_at: string;
  updated_at: string;
  notes: string | null;
  nginx_config: string | null;
  protected: boolean;
}

export interface DomainInput {
  domain: string;
  type: DomainType;
  target: string;
  aliases?: string[];
  autoSsl?: boolean;
  notes?: string;
  enabled?: boolean;
}

const PROTECTED_DOMAINS = new Set(['server.codigoworks.net']);

interface DomainRow {
  id: number;
  domain: string;
  type: DomainType;
  target: string;
  aliases_json: string;
  enabled: number;
  ssl_enabled: number;
  ssl_status: SslStatus;
  ssl_error: string | null;
  auto_ssl: number;
  created_at: string;
  updated_at: string;
  notes: string | null;
  nginx_config: string | null;
}

function mapRow(row: DomainRow): DomainRecord {
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(row.aliases_json || '[]') as string[];
  } catch {
    aliases = [];
  }
  return {
    id: row.id,
    domain: row.domain,
    type: row.type,
    target: row.target,
    aliases,
    enabled: Boolean(row.enabled),
    ssl_enabled: Boolean(row.ssl_enabled),
    ssl_status: row.ssl_status,
    ssl_error: row.ssl_error,
    auto_ssl: Boolean(row.auto_ssl),
    created_at: row.created_at,
    updated_at: row.updated_at,
    notes: row.notes,
    nginx_config: row.nginx_config,
    protected: PROTECTED_DOMAINS.has(row.domain),
  };
}

function normalizeTarget(type: DomainType, target: string): string {
  if (type === 'static') return assertStaticRoot(target);
  if (type === 'proxy') return assertProxyTarget(target);
  return assertRedirectTarget(target);
}

function normalizeAliases(aliases: string[] | undefined, primary: string): string[] {
  const out: string[] = [];
  for (const a of aliases || []) {
    const d = assertDomainName(a);
    if (d !== primary && !out.includes(d)) out.push(d);
  }
  return out;
}

export function listDomains(): DomainRecord[] {
  const rows = getDb()
    .prepare(`SELECT * FROM domains ORDER BY domain COLLATE NOCASE`)
    .all() as DomainRow[];
  return rows.map(mapRow);
}

export function getDomain(domainOrId: string | number): DomainRecord {
  const row =
    typeof domainOrId === 'number' || /^\d+$/.test(String(domainOrId))
      ? (getDb().prepare(`SELECT * FROM domains WHERE id = ?`).get(Number(domainOrId)) as DomainRow | undefined)
      : (getDb()
          .prepare(`SELECT * FROM domains WHERE domain = ? COLLATE NOCASE`)
          .get(String(domainOrId)) as DomainRow | undefined);
  if (!row) throw new AppError('DOMAIN_NOT_FOUND', 'Domain nicht gefunden.', 404);
  return mapRow(row);
}

export async function createDomain(input: DomainInput): Promise<DomainRecord> {
  const domain = assertDomainName(input.domain);
  if (PROTECTED_DOMAINS.has(domain)) {
    throw new AppError('PROTECTED_DOMAIN', 'Diese Domain ist für das Panel reserviert.', 403);
  }
  if (!['static', 'proxy', 'redirect'].includes(input.type)) {
    throw new AppError('VALIDATION_ERROR', 'Ungültiger Domain-Typ.', 400);
  }
  const target = normalizeTarget(input.type, input.target);
  const aliases = normalizeAliases(input.aliases, domain);
  const autoSsl = input.autoSsl !== false;
  const enabled = input.enabled !== false;

  const existing = getDb()
    .prepare(`SELECT id FROM domains WHERE domain = ? COLLATE NOCASE`)
    .get(domain) as { id: number } | undefined;
  if (existing) throw new AppError('DOMAIN_EXISTS', 'Domain existiert bereits.', 409);

  const info = getDb()
    .prepare(
      `INSERT INTO domains (domain, type, target, aliases_json, enabled, auto_ssl, notes, ssl_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'none')`,
    )
    .run(
      domain,
      input.type,
      target,
      JSON.stringify(aliases),
      enabled ? 1 : 0,
      autoSsl ? 1 : 0,
      input.notes || null,
    );

  const record = getDomain(Number(info.lastInsertRowid));
  try {
    await applyDomain(record);
    if (autoSsl && enabled) {
      await requestCertificate(record.domain);
    }
  } catch (err) {
    // Keep DB row so admin can retry/fix; surface error
    throw err;
  }
  return getDomain(record.id);
}

export async function updateDomain(domainOrId: string | number, patch: Partial<DomainInput>): Promise<DomainRecord> {
  const current = getDomain(domainOrId);
  if (current.protected) {
    throw new AppError('PROTECTED_DOMAIN', 'Geschützte Domain kann nicht geändert werden.', 403);
  }

  const type = patch.type || current.type;
  const target = patch.target !== undefined ? normalizeTarget(type, patch.target) : current.target;
  const aliases =
    patch.aliases !== undefined ? normalizeAliases(patch.aliases, current.domain) : current.aliases;
  const autoSsl = patch.autoSsl !== undefined ? patch.autoSsl : current.auto_ssl;
  const enabled = patch.enabled !== undefined ? patch.enabled : current.enabled;
  const notes = patch.notes !== undefined ? patch.notes : current.notes;

  getDb()
    .prepare(
      `UPDATE domains
       SET type = ?, target = ?, aliases_json = ?, enabled = ?, auto_ssl = ?, notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(type, target, JSON.stringify(aliases), enabled ? 1 : 0, autoSsl ? 1 : 0, notes, current.id);

  const updated = getDomain(current.id);
  await applyDomain(updated);
  return getDomain(current.id);
}

export async function deleteDomain(domainOrId: string | number, deleteCert = false): Promise<void> {
  const current = getDomain(domainOrId);
  if (current.protected) {
    throw new AppError('PROTECTED_DOMAIN', 'Geschützte Domain kann nicht gelöscht werden.', 403);
  }
  await runHelper({
    action: 'domain.remove',
    domain: current.domain,
    deleteCert: Boolean(deleteCert),
  });
  getDb().prepare(`DELETE FROM domains WHERE id = ?`).run(current.id);
}

export async function applyDomain(record: DomainRecord): Promise<void> {
  const result = (await runHelper({
    action: 'domain.apply',
    domain: record.domain,
    type: record.type,
    target: record.target,
    aliases: record.aliases,
    enabled: record.enabled,
  })) as { ok?: boolean; configPath?: string; config?: string };

  getDb()
    .prepare(
      `UPDATE domains
       SET nginx_config = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(result.config || null, record.id);
}

export async function requestCertificate(domainOrId: string | number): Promise<DomainRecord> {
  const current = getDomain(domainOrId);
  if (current.protected) {
    throw new AppError('PROTECTED_DOMAIN', 'Geschützte Domain.', 403);
  }
  if (!current.enabled) {
    throw new AppError('DOMAIN_DISABLED', 'Domain ist deaktiviert.', 400);
  }

  getDb()
    .prepare(`UPDATE domains SET ssl_status = 'pending', ssl_error = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(current.id);

  try {
    await runHelper(
      {
        action: 'domain.certbot',
        domain: current.domain,
        aliases: current.aliases,
        email: env.CERTBOT_EMAIL,
      },
      180_000,
    );
    getDb()
      .prepare(
        `UPDATE domains
         SET ssl_enabled = 1, ssl_status = 'active', ssl_error = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(current.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Certbot fehlgeschlagen';
    getDb()
      .prepare(
        `UPDATE domains
         SET ssl_status = 'failed', ssl_error = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(message.slice(0, 500), current.id);
    throw err;
  }

  return getDomain(current.id);
}

export function listAllowedRoots(): string[] {
  return ['/var/www', '/opt/sites', '/srv/www'];
}

export function detectSslOnDisk(domain: string): boolean {
  try {
    return fs.existsSync(path.join('/etc/letsencrypt/live', domain, 'fullchain.pem'));
  } catch {
    return false;
  }
}
