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
