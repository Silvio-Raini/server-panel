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

const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;
const ALLOWED_WEB_ROOTS = ['/var/www', '/opt/sites', '/srv/www'];

export function assertDomainName(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(normalized) || normalized.includes('..') || normalized.includes('/')) {
    throw new AppError('INVALID_DOMAIN', 'Ungültiger Domainname.', 400);
  }
  return normalized;
}

export function assertStaticRoot(rootPath: string): string {
  const normalized = rootPath.replace(/\/+$/, '') || '/';
  if (!normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) {
    throw new AppError('INVALID_ROOT', 'Ungültiger Document-Root.', 400);
  }
  const allowed = ALLOWED_WEB_ROOTS.some(
    (base) => normalized === base || normalized.startsWith(`${base}/`),
  );
  if (!allowed) {
    throw new AppError(
      'ROOT_NOT_ALLOWED',
      `Document-Root muss unter ${ALLOWED_WEB_ROOTS.join(', ')} liegen.`,
      400,
    );
  }
  return normalized;
}

/** Accepts "8080", "127.0.0.1:8080" or "localhost:8080". */
export function assertProxyTarget(target: string): string {
  const trimmed = target.trim();
  if (/^\d{1,5}$/.test(trimmed)) {
    const port = Number(trimmed);
    if (port < 1 || port > 65535 || port === 22) {
      throw new AppError('INVALID_PROXY_TARGET', 'Ungültiger Port.', 400);
    }
    return `127.0.0.1:${port}`;
  }
  const m = trimmed.match(/^(127\.0\.0\.1|localhost):(\d{1,5})$/i);
  if (!m) {
    throw new AppError(
      'INVALID_PROXY_TARGET',
      'Proxy-Ziel muss localhost/127.0.0.1:PORT oder nur PORT sein.',
      400,
    );
  }
  const port = Number(m[2]);
  if (port < 1 || port > 65535 || port === 22) {
    throw new AppError('INVALID_PROXY_TARGET', 'Ungültiger Port.', 400);
  }
  return `127.0.0.1:${port}`;
}

export function assertRedirectTarget(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('INVALID_REDIRECT', 'Ungültige Redirect-URL.', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('INVALID_REDIRECT', 'Redirect muss http(s) verwenden.', 400);
  }
  return parsed.toString();
}
