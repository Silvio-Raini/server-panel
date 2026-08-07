import { getDb } from '../../database/db.js';
import { runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { PROTECTED_USERS, assertUsername } from '../../utils/validate.js';

export type SftpPermission = 'rw' | 'ro';

export interface SftpAccount {
  id: number;
  username: string;
  permission: SftpPermission;
  home: string;
  dataPath: string;
  enabled: boolean;
  locked: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SftpCreateInput {
  username: string;
  password: string;
  permission?: SftpPermission;
  notes?: string;
}

interface SftpRow {
  id: number;
  username: string;
  permission: SftpPermission;
  home: string;
  enabled: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const SFTP_BASE = '/var/sftp';

function mapRow(row: SftpRow): SftpAccount {
  return {
    id: row.id,
    username: row.username,
    permission: row.permission,
    home: row.home,
    dataPath: `${row.home}/data`,
    enabled: Boolean(row.enabled),
    locked: !row.enabled,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function assertSftpUsername(username: string): string {
  const u = assertUsername(username);
  if (PROTECTED_USERS.has(u) || u.startsWith('systemd-') || u === 'admin') {
    throw new AppError('PROTECTED_USER', 'Dieser Benutzername ist geschützt.', 403);
  }
  // Keep SFTP accounts clearly separated from normal interactive users
  if (!/^sftp_[a-z0-9_]{1,27}$/.test(u)) {
    throw new AppError(
      'INVALID_SFTP_USERNAME',
      'SFTP-Benutzer müssen dem Muster sftp_name entsprechen (nur a-z, 0-9, _).',
      400,
    );
  }
  return u;
}

function assertPermission(permission: string): SftpPermission {
  if (permission !== 'rw' && permission !== 'ro') {
    throw new AppError('INVALID_PERMISSION', 'Berechtigung muss rw oder ro sein.', 400);
  }
  return permission;
}

export function listSftpAccounts(): SftpAccount[] {
  const rows = getDb()
    .prepare(`SELECT * FROM sftp_accounts ORDER BY username COLLATE NOCASE`)
    .all() as SftpRow[];
  return rows.map(mapRow);
}

export function getSftpAccount(usernameOrId: string | number): SftpAccount {
  const row =
    typeof usernameOrId === 'number' || /^\d+$/.test(String(usernameOrId))
      ? (getDb().prepare(`SELECT * FROM sftp_accounts WHERE id = ?`).get(Number(usernameOrId)) as
          | SftpRow
          | undefined)
      : (getDb()
          .prepare(`SELECT * FROM sftp_accounts WHERE username = ? COLLATE NOCASE`)
          .get(String(usernameOrId)) as SftpRow | undefined);
  if (!row) throw new AppError('SFTP_NOT_FOUND', 'SFTP-Account nicht gefunden.', 404);
  return mapRow(row);
}

export async function ensureSftpInfra(): Promise<void> {
  await runHelper({ action: 'sftp.ensureInfra' });
}

export async function createSftpAccount(input: SftpCreateInput): Promise<SftpAccount> {
  const username = assertSftpUsername(input.username);
  if (!input.password || input.password.length < 10) {
    throw new AppError('WEAK_PASSWORD', 'SFTP-Passwort muss mindestens 10 Zeichen haben.', 400);
  }
  const permission = assertPermission(input.permission || 'rw');
  const home = `${SFTP_BASE}/${username}`;

  const exists = getDb()
    .prepare(`SELECT id FROM sftp_accounts WHERE username = ? COLLATE NOCASE`)
    .get(username) as { id: number } | undefined;
  if (exists) throw new AppError('SFTP_EXISTS', 'SFTP-Account existiert bereits.', 409);

  await ensureSftpInfra();
  await runHelper({
    action: 'sftp.create',
    username,
    password: input.password,
    permission,
    home,
  });

  const info = getDb()
    .prepare(
      `INSERT INTO sftp_accounts (username, permission, home, enabled, notes)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run(username, permission, home, input.notes || null);

  return getSftpAccount(Number(info.lastInsertRowid));
}

export async function updateSftpAccount(
  usernameOrId: string | number,
  patch: { permission?: SftpPermission; notes?: string | null; enabled?: boolean },
): Promise<SftpAccount> {
  const current = getSftpAccount(usernameOrId);
  const permission =
    patch.permission !== undefined ? assertPermission(patch.permission) : current.permission;
  const notes = patch.notes !== undefined ? patch.notes : current.notes;
  const enabled = patch.enabled !== undefined ? patch.enabled : current.enabled;

  if (permission !== current.permission) {
    await runHelper({
      action: 'sftp.setPermission',
      username: current.username,
      permission,
      home: current.home,
    });
  }

  if (enabled !== current.enabled) {
    await runHelper({
      action: enabled ? 'sftp.unlock' : 'sftp.lock',
      username: current.username,
    });
  }

  getDb()
    .prepare(
      `UPDATE sftp_accounts
       SET permission = ?, notes = ?, enabled = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(permission, notes, enabled ? 1 : 0, current.id);

  return getSftpAccount(current.id);
}

export async function setSftpPassword(usernameOrId: string | number, password: string): Promise<void> {
  const current = getSftpAccount(usernameOrId);
  if (!password || password.length < 10) {
    throw new AppError('WEAK_PASSWORD', 'SFTP-Passwort muss mindestens 10 Zeichen haben.', 400);
  }
  await runHelper({
    action: 'sftp.setPassword',
    username: current.username,
    password,
  });
  getDb()
    .prepare(`UPDATE sftp_accounts SET updated_at = datetime('now') WHERE id = ?`)
    .run(current.id);
}

export async function deleteSftpAccount(
  usernameOrId: string | number,
  removeData: boolean,
): Promise<void> {
  const current = getSftpAccount(usernameOrId);
  await runHelper({
    action: 'sftp.delete',
    username: current.username,
    home: current.home,
    removeData,
  });
  getDb().prepare(`DELETE FROM sftp_accounts WHERE id = ?`).run(current.id);
}

export function sftpConnectionInfo() {
  return {
    host: 'server.codigoworks.net',
    port: 22,
    protocol: 'sftp',
    basePath: SFTP_BASE,
    chrootNote:
      'Nach Login liegt das schreibbare Verzeichnis unter /data (Chroot). Shell-Zugang ist deaktiviert.',
    usernamePattern: 'sftp_name',
  };
}
