import { spawn } from 'node:child_process';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(bin: string, args: string[], timeoutMs = 30_000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new AppError('COMMAND_TIMEOUT', 'Der Systembefehl ist abgelaufen.', 504));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
      if (stdout.length > 5_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
      if (stderr.length > 1_000_000) child.kill('SIGKILL');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

/** Read-only / unprivileged local commands (no shell). */
export async function execFileSafe(
  bin: string,
  args: string[],
  options?: { timeoutMs?: number; allowFailure?: boolean },
): Promise<ExecResult> {
  const allowedBins = new Set([
    '/usr/bin/systemctl',
    '/bin/systemctl',
    '/usr/bin/journalctl',
    '/bin/journalctl',
    '/usr/bin/hostnamectl',
    '/usr/bin/timedatectl',
    '/usr/bin/df',
    '/bin/df',
    '/usr/bin/free',
    '/usr/bin/uptime',
    '/usr/bin/ps',
    '/bin/ps',
    '/usr/bin/ss',
    '/usr/sbin/ip',
    '/bin/ip',
    '/usr/bin/ip',
    '/usr/bin/cat',
    '/bin/cat',
    '/usr/bin/getent',
    '/usr/bin/lastlog',
    '/usr/bin/who',
    '/usr/bin/id',
    '/usr/bin/stat',
    '/usr/bin/uname',
    '/bin/uname',
    '/usr/bin/nproc',
    '/usr/bin/findmnt',
    '/usr/bin/resolvectl',
    '/usr/bin/curl',
  ]);

  if (!allowedBins.has(bin)) {
    throw new AppError('COMMAND_NOT_ALLOWED', 'Befehl ist nicht erlaubt.', 500);
  }

  const result = await run(bin, args, options?.timeoutMs);
  if (result.code !== 0 && !options?.allowFailure) {
    throw new AppError(
      'COMMAND_FAILED',
      'Systembefehl fehlgeschlagen.',
      500,
      { bin, code: result.code, stderr: result.stderr.slice(0, 500) },
    );
  }
  return result;
}

export type HelperAction =
  | { action: 'service'; op: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable'; unit: string }
  | { action: 'user.create'; username: string; password: string; shell?: string; home?: string; groups?: string[] }
  | { action: 'user.delete'; username: string; removeHome: boolean }
  | { action: 'user.lock' | 'user.unlock'; username: string }
  | { action: 'user.passwd'; username: string; password: string }
  | { action: 'user.modify'; username: string; shell?: string; home?: string; primaryGroup?: string }
  | { action: 'user.addGroup' | 'user.removeGroup'; username: string; group: string }
  | { action: 'group.create'; name: string }
  | { action: 'group.delete'; name: string }
  | { action: 'process.signal'; pid: number; signal: 'TERM' | 'KILL' }
  | {
      action: 'domain.apply';
      domain: string;
      type: 'static' | 'proxy' | 'redirect';
      target: string;
      aliases?: string[];
      enabled?: boolean;
    }
  | { action: 'domain.remove'; domain: string; deleteCert?: boolean }
  | { action: 'domain.certbot'; domain: string; aliases?: string[]; email?: string };

/** Privileged operations via fixed helper binary + sudo (no shell). */
export async function runHelper(payload: HelperAction, timeoutMs = 60_000): Promise<unknown> {
  const result = await run('sudo', ['-n', env.HELPER_PATH, JSON.stringify(payload)], timeoutMs);
  if (result.code !== 0) {
    let message = 'Privilegierte Operation fehlgeschlagen.';
    try {
      const parsed = JSON.parse(result.stdout || result.stderr) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* ignore */
    }
    throw new AppError('HELPER_FAILED', message, 500, {
      code: result.code,
      stderr: result.stderr.slice(0, 500),
    });
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    return { ok: true };
  }
}
