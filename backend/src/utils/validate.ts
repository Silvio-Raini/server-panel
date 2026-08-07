import { AppError } from './errors.js';

const SERVICE_RE = /^[a-zA-Z0-9@._:-]+\.service$/;
const UNIT_RE = /^[a-zA-Z0-9@._:-]+\.(service|timer|socket|target|mount|path)$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SHELL_RE = /^\/[a-zA-Z0-9/_-]+$/;

export const PROTECTED_USERS = new Set([
  'root',
  'daemon',
  'bin',
  'sys',
  'sync',
  'games',
  'man',
  'lp',
  'mail',
  'news',
  'uucp',
  'proxy',
  'www-data',
  'backup',
  'list',
  'irc',
  'gnats',
  'nobody',
  'systemd-network',
  'systemd-resolve',
  'systemd-timesync',
  'messagebus',
  'sshd',
  'server-panel',
  '_apt',
  'polkitd',
  'uuidd',
]);

export const PROTECTED_GROUPS = new Set([
  'root',
  'daemon',
  'bin',
  'sys',
  'adm',
  'tty',
  'disk',
  'sudo',
  'audio',
  'video',
  'netdev',
  'www-data',
  'systemd-journal',
  'systemd-network',
  'systemd-resolve',
  'messagebus',
  'server-panel',
  'nogroup',
]);

export const CRITICAL_SERVICES = new Set([
  'ssh.service',
  'sshd.service',
  'systemd-logind.service',
  'dbus.service',
  'dbus-broker.service',
  'nginx.service',
  'server-panel.service',
  'fail2ban.service',
]);

export function assertServiceName(name: string, allowUnitSuffix = false): string {
  const normalized = name.endsWith('.service') || name.includes('.') ? name : `${name}.service`;
  const re = allowUnitSuffix ? UNIT_RE : SERVICE_RE;
  if (!re.test(normalized) || normalized.includes('..') || normalized.includes('/')) {
    throw new AppError('INVALID_SERVICE_NAME', 'Ungültiger Service-Name.', 400);
  }
  return normalized;
}

export function assertUsername(username: string): string {
  if (!USER_RE.test(username) || username.includes('..')) {
    throw new AppError('INVALID_USERNAME', 'Ungültiger Benutzername.', 400);
  }
  return username;
}

export function assertGroupName(name: string): string {
  if (!GROUP_RE.test(name) || name.includes('..')) {
    throw new AppError('INVALID_GROUP_NAME', 'Ungültiger Gruppenname.', 400);
  }
  return name;
}

export function assertShell(shell: string): string {
  if (!SHELL_RE.test(shell)) {
    throw new AppError('INVALID_SHELL', 'Ungültige Shell.', 400);
  }
  return shell;
}

export function assertPid(pid: number): number {
  if (!Number.isInteger(pid) || pid <= 1 || pid > 4_194_304) {
    throw new AppError('INVALID_PID', 'Ungültige Prozess-ID.', 400);
  }
  return pid;
}

export function assertNotProtectedUser(username: string): void {
  if (PROTECTED_USERS.has(username) || username.startsWith('systemd-')) {
    throw new AppError('PROTECTED_USER', 'Dieser Systembenutzer ist geschützt.', 403);
  }
}

export function assertNotProtectedGroup(name: string): void {
  if (PROTECTED_GROUPS.has(name) || name.startsWith('systemd-')) {
    throw new AppError('PROTECTED_GROUP', 'Diese Systemgruppe ist geschützt.', 403);
  }
}
