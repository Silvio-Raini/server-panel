#!/usr/bin/env node
/**
 * Privileged helper – runs as root via sudo.
 * Accepts a single JSON argument describing a validated action.
 * Never executes arbitrary shell commands.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SERVICE_RE = /^[a-zA-Z0-9@._:-]+\.service$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SHELL_RE = /^\/[a-zA-Z0-9/_-]+$/;

const PROTECTED_USERS = new Set([
  'root',
  'daemon',
  'bin',
  'sys',
  'www-data',
  'nobody',
  'sshd',
  'server-panel',
  'systemd-network',
  'systemd-resolve',
  'messagebus',
]);

const PROTECTED_GROUPS = new Set([
  'root',
  'sudo',
  'adm',
  'www-data',
  'server-panel',
  'systemd-journal',
  'nogroup',
]);

const CRITICAL_SERVICES = new Set([
  'ssh.service',
  'sshd.service',
  'nginx.service',
  'server-panel.service',
  'dbus.service',
  'fail2ban.service',
]);

const PROTECTED_DOMAINS = new Set(['server.codigoworks.net']);
const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const ALLOWED_WEB_ROOTS = ['/var/www', '/opt/sites', '/srv/www'];
const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';

type Payload = Record<string, unknown>;

function fail(message: string, code = 1): never {
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exit(code);
}

function ok(data: unknown = {}): never {
  process.stdout.write(JSON.stringify({ ok: true, ...((data as object) || {}) }));
  process.exit(0);
}

function run(bin: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function assertService(unit: unknown): string {
  if (typeof unit !== 'string' || !SERVICE_RE.test(unit)) fail('Ungültiger Service-Name');
  return unit;
}

function assertUser(username: unknown): string {
  if (typeof username !== 'string' || !USER_RE.test(username)) fail('Ungültiger Benutzername');
  if (PROTECTED_USERS.has(username) || username.startsWith('systemd-')) fail('Geschützter Benutzer');
  return username;
}

function assertGroup(name: unknown): string {
  if (typeof name !== 'string' || !GROUP_RE.test(name)) fail('Ungültiger Gruppenname');
  if (PROTECTED_GROUPS.has(name) || name.startsWith('systemd-')) fail('Geschützte Gruppe');
  return name;
}

function assertDomain(domain: unknown): string {
  if (typeof domain !== 'string') fail('Ungültiger Domainname');
  const normalized = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(normalized) || normalized.includes('..') || normalized.includes('/')) {
    fail('Ungültiger Domainname');
  }
  return normalized;
}

function domainToSlug(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/gi, '_');
}

function normalizeAliases(raw: unknown, primary: string): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const d = assertDomain(item);
    if (d !== primary && !out.includes(d)) out.push(d);
  }
  return out;
}

function assertStaticRoot(rootPath: string): string {
  const normalized = rootPath.replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) {
    fail('Ungültiger Document-Root');
  }
  const allowed = ALLOWED_WEB_ROOTS.some(
    (base) => normalized === base || normalized.startsWith(`${base}/`),
  );
  if (!allowed) fail(`Document-Root muss unter ${ALLOWED_WEB_ROOTS.join(', ')} liegen`);
  return normalized;
}

function assertProxyTarget(target: string): string {
  const trimmed = target.trim();
  if (/^\d{1,5}$/.test(trimmed)) {
    const port = Number(trimmed);
    if (port < 1 || port > 65535 || port === 22) fail('Ungültiger Port');
    return `127.0.0.1:${port}`;
  }
  const m = trimmed.match(/^(127\.0\.0\.1|localhost):(\d{1,5})$/i);
  if (!m) fail('Proxy-Ziel muss localhost/127.0.0.1:PORT oder nur PORT sein');
  const port = Number(m[2]);
  if (port < 1 || port > 65535 || port === 22) fail('Ungültiger Port');
  return `127.0.0.1:${port}`;
}

function assertRedirectTarget(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail('Ungültige Redirect-URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('Redirect muss http(s) verwenden');
  }
  return parsed.toString();
}

function assertSftpUser(username: unknown): string {
  if (typeof username !== 'string' || !USER_RE.test(username)) fail('Ungültiger Benutzername');
  if (!/^sftp_[a-z0-9_]{1,27}$/.test(username)) fail('SFTP-Benutzer muss sftp_name entsprechen');
  if (PROTECTED_USERS.has(username)) fail('Geschützter Benutzer');
  return username;
}

function assertSftpHome(home: string, username: string): string {
  const expected = path.join('/var/sftp', username);
  const normalized = path.resolve(home);
  if (normalized !== expected || normalized.includes('..')) fail('Ungültiges SFTP-Home');
  return normalized;
}

async function main(): Promise<void> {
  if (process.getuid && process.getuid() !== 0) fail('Helper muss als root laufen', 2);
  const raw = process.argv[2];
  if (!raw) fail('Payload fehlt');
  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    fail('Ungültiges JSON');
  }

  const action = payload.action;
  try {
    switch (action) {
      case 'service': {
        const op = payload.op;
        const unit = assertService(payload.unit);
        if (!['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(String(op))) {
          fail('Ungültige Service-Operation');
        }
        if (CRITICAL_SERVICES.has(unit) && (op === 'stop' || op === 'disable')) {
          fail('Kritischer Service geschützt');
        }
        const r = await run('/usr/bin/systemctl', [String(op), unit]);
        if (r.code !== 0) fail(r.stderr.trim() || `systemctl ${op} fehlgeschlagen`);
        ok();
      }
      case 'user.create': {
        const username = assertUser(payload.username);
        const password = String(payload.password || '');
        if (password.length < 8) fail('Passwort zu kurz');
        const shell = typeof payload.shell === 'string' && SHELL_RE.test(payload.shell) ? payload.shell : '/bin/bash';
        const args = ['--create-home', '--shell', shell, username];
        const r = await run('/usr/sbin/useradd', args);
        if (r.code !== 0) fail(r.stderr.trim() || 'useradd fehlgeschlagen');
        const p = await run('/usr/sbin/chpasswd', [], `${username}:${password}\n`);
        if (p.code !== 0) fail('Passwort setzen fehlgeschlagen');
        if (Array.isArray(payload.groups)) {
          for (const g of payload.groups) {
            const group = assertGroup(g);
            await run('/usr/sbin/usermod', ['-aG', group, username]);
          }
        }
        ok();
      }
      case 'user.delete': {
        const username = assertUser(payload.username);
        const args = payload.removeHome ? ['-r', username] : [username];
        const r = await run('/usr/sbin/userdel', args);
        if (r.code !== 0) fail(r.stderr.trim() || 'userdel fehlgeschlagen');
        ok();
      }
      case 'user.lock': {
        const username = assertUser(payload.username);
        const r = await run('/usr/sbin/usermod', ['--lock', username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'lock fehlgeschlagen');
        ok();
      }
      case 'user.unlock': {
        const username = assertUser(payload.username);
        const r = await run('/usr/sbin/usermod', ['--unlock', username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'unlock fehlgeschlagen');
        ok();
      }
      case 'user.passwd': {
        const username = assertUser(payload.username);
        const password = String(payload.password || '');
        if (password.length < 8) fail('Passwort zu kurz');
        const p = await run('/usr/sbin/chpasswd', [], `${username}:${password}\n`);
        if (p.code !== 0) fail('Passwort setzen fehlgeschlagen');
        ok();
      }
      case 'user.modify': {
        const username = assertUser(payload.username);
        const args: string[] = [];
        if (typeof payload.shell === 'string') {
          if (!SHELL_RE.test(payload.shell)) fail('Ungültige Shell');
          args.push('-s', payload.shell);
        }
        if (typeof payload.home === 'string') {
          if (!payload.home.startsWith('/') || payload.home.includes('..')) fail('Ungültiges Home');
          args.push('-d', payload.home);
        }
        if (typeof payload.primaryGroup === 'string') {
          args.push('-g', assertGroup(payload.primaryGroup));
        }
        if (!args.length) ok();
        const r = await run('/usr/sbin/usermod', [...args, username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'usermod fehlgeschlagen');
        ok();
      }
      case 'user.addGroup': {
        const username = assertUser(payload.username);
        const group = assertGroup(payload.group);
        const r = await run('/usr/sbin/usermod', ['-aG', group, username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'Gruppe hinzufügen fehlgeschlagen');
        ok();
      }
      case 'user.removeGroup': {
        const username = assertUser(payload.username);
        const group = assertGroup(payload.group);
        const r = await run('/usr/bin/gpasswd', ['-d', username, group]);
        if (r.code !== 0) fail(r.stderr.trim() || 'Gruppe entfernen fehlgeschlagen');
        ok();
      }
      case 'group.create': {
        const name = assertGroup(payload.name);
        const r = await run('/usr/sbin/groupadd', [name]);
        if (r.code !== 0) fail(r.stderr.trim() || 'groupadd fehlgeschlagen');
        ok();
      }
      case 'group.delete': {
        const name = assertGroup(payload.name);
        const r = await run('/usr/sbin/groupdel', [name]);
        if (r.code !== 0) fail(r.stderr.trim() || 'groupdel fehlgeschlagen');
        ok();
      }
      case 'process.signal': {
        const pid = Number(payload.pid);
        const signal = payload.signal;
        if (!Number.isInteger(pid) || pid <= 1) fail('Ungültige PID');
        if (signal !== 'TERM' && signal !== 'KILL') fail('Ungültiges Signal');
        // Refuse killing PID 1 and our own parent chain naively by checking comm
        try {
          const comm = fs.readFileSync(path.join('/proc', String(pid), 'comm'), 'utf8').trim();
          if (comm === 'systemd' && pid === 1) fail('PID 1 geschützt');
        } catch {
          fail('Prozess nicht gefunden');
        }
        const r = await run('/bin/kill', [`-${signal}`, String(pid)]);
        if (r.code !== 0) fail(r.stderr.trim() || 'kill fehlgeschlagen');
        ok();
      }
      case 'domain.apply': {
        const domain = assertDomain(payload.domain);
        if (PROTECTED_DOMAINS.has(domain)) fail('Geschützte Domain');
        const type = String(payload.type);
        if (!['static', 'proxy', 'redirect'].includes(type)) fail('Ungültiger Domain-Typ');
        const aliases = normalizeAliases(payload.aliases, domain);
        const enabled = payload.enabled !== false;
        const target =
          type === 'static'
            ? assertStaticRoot(String(payload.target || ''))
            : type === 'proxy'
              ? assertProxyTarget(String(payload.target || ''))
              : assertRedirectTarget(String(payload.target || ''));

        if (type === 'static') {
          fs.mkdirSync(target, { recursive: true, mode: 0o755 });
          try {
            fs.chownSync(target, 33, 33); // www-data
          } catch {
            /* ignore */
          }
        }

        const names = [domain, ...aliases];
        const serverNames = names.join(' ');
        const slug = domainToSlug(domain);
        const available = path.join(SITES_AVAILABLE, `sp-${slug}.conf`);
        const enabledPath = path.join(SITES_ENABLED, `sp-${slug}.conf`);

        let locationBlock = '';
        if (type === 'static') {
          locationBlock = `
    root ${target};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }`;
        } else if (type === 'proxy') {
          locationBlock = `
    location / {
        proxy_pass http://${target};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }`;
        } else {
          locationBlock = `
    location / {
        return 301 ${target.replace(/\/$/, '')}$request_uri;
    }`;
        }

        const hasCert = fs.existsSync(path.join('/etc/letsencrypt/live', domain, 'fullchain.pem'));
        let config = '';
        if (hasCert) {
          config = `# managed-by: server-panel
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverNames};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
${locationBlock}
}
`;
        } else {
          config = `# managed-by: server-panel
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
${locationBlock}
}
`;
        }

        if (!enabled) {
          // Keep file but disable symlink
          fs.writeFileSync(available, config, { mode: 0o644 });
          try {
            fs.unlinkSync(enabledPath);
          } catch {
            /* ignore */
          }
        } else {
          fs.writeFileSync(available, config, { mode: 0o644 });
          try {
            fs.unlinkSync(enabledPath);
          } catch {
            /* ignore */
          }
          fs.symlinkSync(available, enabledPath);
        }

        const test = await run('/usr/sbin/nginx', ['-t']);
        if (test.code !== 0) {
          // rollback symlink if test fails on brand-new broken config
          fail(test.stderr.trim() || 'nginx -t fehlgeschlagen');
        }
        const reload = await run('/usr/bin/systemctl', ['reload', 'nginx']);
        if (reload.code !== 0) fail(reload.stderr.trim() || 'nginx reload fehlgeschlagen');
        ok({ configPath: available, config });
      }
      case 'domain.remove': {
        const domain = assertDomain(payload.domain);
        if (PROTECTED_DOMAINS.has(domain)) fail('Geschützte Domain');
        const slug = domainToSlug(domain);
        const available = path.join(SITES_AVAILABLE, `sp-${slug}.conf`);
        const enabledPath = path.join(SITES_ENABLED, `sp-${slug}.conf`);
        try {
          fs.unlinkSync(enabledPath);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(available);
        } catch {
          /* ignore */
        }
        if (payload.deleteCert) {
          await run('/usr/bin/certbot', ['delete', '--cert-name', domain, '--non-interactive']);
        }
        const test = await run('/usr/sbin/nginx', ['-t']);
        if (test.code !== 0) fail(test.stderr.trim() || 'nginx -t fehlgeschlagen');
        const reload = await run('/usr/bin/systemctl', ['reload', 'nginx']);
        if (reload.code !== 0) fail(reload.stderr.trim() || 'nginx reload fehlgeschlagen');
        ok();
      }
      case 'domain.certbot': {
        const domain = assertDomain(payload.domain);
        if (PROTECTED_DOMAINS.has(domain)) fail('Geschützte Domain');
        const aliases = normalizeAliases(payload.aliases, domain);
        const email =
          typeof payload.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
            ? payload.email
            : 'admin@codigoworks.net';
        const args = [
          '--nginx',
          '--non-interactive',
          '--agree-tos',
          '--redirect',
          '-m',
          email,
          '-d',
          domain,
        ];
        for (const alias of aliases) {
          args.push('-d', alias);
        }
        const r = await run('/usr/bin/certbot', args);
        if (r.code !== 0) {
          fail((r.stderr || r.stdout).trim().slice(0, 800) || 'certbot fehlgeschlagen');
        }
        ok({ stdout: r.stdout.slice(0, 500) });
      }
      case 'sftp.ensureInfra': {
        // Groups
        for (const group of ['sftpusers', 'sftpreadonly']) {
          const exists = await run('/usr/bin/getent', ['group', group]);
          if (exists.code !== 0) {
            const g = await run('/usr/sbin/groupadd', ['--system', group]);
            if (g.code !== 0) fail(g.stderr.trim() || `groupadd ${group} fehlgeschlagen`);
          }
        }
        fs.mkdirSync('/var/sftp', { recursive: true, mode: 0o755 });
        fs.chownSync('/var/sftp', 0, 0);
        fs.chmodSync('/var/sftp', 0o755);

        const confPath = '/etc/ssh/sshd_config.d/60-server-panel-sftp.conf';
        const conf = `# managed-by: server-panel
# Chrooted SFTP-only accounts (no shell, no forwarding)
Match Group sftpusers
    ChrootDirectory /var/sftp/%u
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    AllowAgentForwarding no
    PermitTunnel no
    PermitTTY no
    PasswordAuthentication yes

# Read-only override for members of sftpreadonly
Match Group sftpreadonly
    ForceCommand internal-sftp -R
`;
        fs.writeFileSync(confPath, conf, { mode: 0o644 });
        const test = await run('/usr/sbin/sshd', ['-t']);
        if (test.code !== 0) fail(test.stderr.trim() || 'sshd -t fehlgeschlagen');
        const reload = await run('/usr/bin/systemctl', ['reload', 'ssh']);
        if (reload.code !== 0) fail(reload.stderr.trim() || 'ssh reload fehlgeschlagen');
        ok({ confPath });
      }
      case 'sftp.create': {
        const username = assertSftpUser(payload.username);
        const password = String(payload.password || '');
        if (password.length < 10) fail('Passwort zu kurz');
        const permission = String(payload.permission || 'rw');
        if (permission !== 'rw' && permission !== 'ro') fail('Ungültige Berechtigung');
        const home = assertSftpHome(String(payload.home || ''), username);

        // Refuse if system user already exists
        const existing = await run('/usr/bin/id', ['-u', username]);
        if (existing.code === 0) fail('Benutzer existiert bereits im System');

        fs.mkdirSync(home, { recursive: true, mode: 0o755 });
        fs.chownSync(home, 0, 0);
        fs.chmodSync(home, 0o755);

        const dataDir = path.join(home, 'data');
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });

        const create = await run('/usr/sbin/useradd', [
          '--system',
          '--home-dir',
          home,
          '--no-create-home',
          '--shell',
          '/usr/sbin/nologin',
          '--gid',
          'sftpusers',
          '--groups',
          permission === 'ro' ? 'sftpusers,sftpreadonly' : 'sftpusers',
          username,
        ]);
        if (create.code !== 0) fail(create.stderr.trim() || 'useradd fehlgeschlagen');

        const uidRes = await run('/usr/bin/id', ['-u', username]);
        const gidRes = await run('/usr/bin/id', ['-g', username]);
        const uid = Number(uidRes.stdout.trim());
        const gid = Number(gidRes.stdout.trim());
        if (!Number.isInteger(uid) || !Number.isInteger(gid)) fail('UID/GID konnte nicht ermittelt werden');

        if (permission === 'ro') {
          fs.chownSync(dataDir, 0, 0);
          fs.chmodSync(dataDir, 0o555);
        } else {
          fs.chownSync(dataDir, uid, gid);
          fs.chmodSync(dataDir, 0o750);
        }

        const pass = await run('/usr/sbin/chpasswd', [], `${username}:${password}\n`);
        if (pass.code !== 0) fail('Passwort setzen fehlgeschlagen');

        // Ensure account is unlocked/expired appropriately
        await run('/usr/sbin/usermod', ['--unlock', username]);
        ok({ home, dataDir, permission });
      }
      case 'sftp.setPermission': {
        const username = assertSftpUser(payload.username);
        const permission = String(payload.permission || '');
        if (permission !== 'rw' && permission !== 'ro') fail('Ungültige Berechtigung');
        const home = assertSftpHome(String(payload.home || ''), username);
        const dataDir = path.join(home, 'data');

        const uidRes = await run('/usr/bin/id', ['-u', username]);
        const gidRes = await run('/usr/bin/id', ['-g', username]);
        if (uidRes.code !== 0) fail('Benutzer nicht gefunden');
        const uid = Number(uidRes.stdout.trim());
        const gid = Number(gidRes.stdout.trim());

        if (permission === 'ro') {
          await run('/usr/sbin/usermod', ['-aG', 'sftpreadonly', username]);
          fs.chownSync(dataDir, 0, 0);
          fs.chmodSync(dataDir, 0o555);
        } else {
          // remove from readonly group (ignore if not a member)
          await run('/usr/bin/gpasswd', ['-d', username, 'sftpreadonly']);
          fs.chownSync(dataDir, uid, gid);
          fs.chmodSync(dataDir, 0o750);
        }
        ok({ permission });
      }
      case 'sftp.setPassword': {
        const username = assertSftpUser(payload.username);
        const password = String(payload.password || '');
        if (password.length < 10) fail('Passwort zu kurz');
        // Ensure this is an sftp user
        const groups = await run('/usr/bin/id', ['-nG', username]);
        if (groups.code !== 0 || !groups.stdout.split(/\s+/).includes('sftpusers')) {
          fail('Kein SFTP-Account');
        }
        const pass = await run('/usr/sbin/chpasswd', [], `${username}:${password}\n`);
        if (pass.code !== 0) fail('Passwort setzen fehlgeschlagen');
        ok();
      }
      case 'sftp.lock': {
        const username = assertSftpUser(payload.username);
        const groups = await run('/usr/bin/id', ['-nG', username]);
        if (groups.code !== 0 || !groups.stdout.split(/\s+/).includes('sftpusers')) {
          fail('Kein SFTP-Account');
        }
        const r = await run('/usr/sbin/usermod', ['--lock', username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'Sperren fehlgeschlagen');
        ok();
      }
      case 'sftp.unlock': {
        const username = assertSftpUser(payload.username);
        const groups = await run('/usr/bin/id', ['-nG', username]);
        if (groups.code !== 0 || !groups.stdout.split(/\s+/).includes('sftpusers')) {
          fail('Kein SFTP-Account');
        }
        const r = await run('/usr/sbin/usermod', ['--unlock', username]);
        if (r.code !== 0) fail(r.stderr.trim() || 'Entsperren fehlgeschlagen');
        ok();
      }
      case 'sftp.delete': {
        const username = assertSftpUser(payload.username);
        const home = assertSftpHome(String(payload.home || ''), username);
        const groups = await run('/usr/bin/id', ['-nG', username]);
        if (groups.code !== 0 || !groups.stdout.split(/\s+/).includes('sftpusers')) {
          fail('Kein SFTP-Account');
        }
        // Terminate active SFTP/SSH sessions for this user (no shell wildcards)
        await run('/usr/bin/pkill', ['-KILL', '-u', username]);
        // brief settle; userdel may still race otherwise
        await new Promise((r) => setTimeout(r, 300));
        let del = await run('/usr/sbin/userdel', [username]);
        if (del.code !== 0) {
          await run('/usr/bin/pkill', ['-KILL', '-u', username]);
          await new Promise((r) => setTimeout(r, 300));
          del = await run('/usr/sbin/userdel', [username]);
        }
        if (del.code !== 0) fail(del.stderr.trim() || 'userdel fehlgeschlagen');
        if (payload.removeData) {
          // Only delete under /var/sftp/<user>
          fs.rmSync(home, { recursive: true, force: true });
        }
        ok();
      }
      default:
        fail('Unbekannte Aktion');
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : 'Helper-Fehler');
  }
}

// silence unused imports in some builds
void os;

main();
