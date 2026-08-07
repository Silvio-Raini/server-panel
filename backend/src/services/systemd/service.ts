import { execFileSafe, runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { CRITICAL_SERVICES, assertServiceName } from '../../utils/validate.js';

export interface ServiceInfo {
  name: string;
  description: string;
  activeState: string;
  subState: string;
  unitFileState: string;
  enabled: boolean;
  running: boolean;
  mainPid: number | null;
  activeEnterTimestamp: string | null;
  fragmentPath: string | null;
}

function parseShow(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

export async function listServices(): Promise<ServiceInfo[]> {
  const listed = await execFileSafe(
    '/usr/bin/systemctl',
    ['list-units', '--type=service', '--all', '--no-pager', '--no-legend', '--plain'],
    { allowFailure: true },
  );

  const names = listed.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => n && n.endsWith('.service'))
    .slice(0, 400);

  const results: ServiceInfo[] = [];
  // Batch show in chunks for performance
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    const shown = await execFileSafe(
      '/usr/bin/systemctl',
      ['show', ...chunk, '--property=Id,Description,ActiveState,SubState,UnitFileState,MainPID,ActiveEnterTimestamp,FragmentPath'],
      { allowFailure: true },
    );
    const blocks = shown.stdout.split('\n\n').filter(Boolean);
    for (const block of blocks) {
      const p = parseShow(block);
      if (!p.Id) continue;
      results.push(mapProps(p));
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getService(name: string): Promise<ServiceInfo> {
  const unit = assertServiceName(name);
  const shown = await execFileSafe(
    '/usr/bin/systemctl',
    [
      'show',
      unit,
      '--property=Id,Description,ActiveState,SubState,UnitFileState,MainPID,ActiveEnterTimestamp,FragmentPath',
    ],
    { allowFailure: true },
  );
  const p = parseShow(shown.stdout);
  if (!p.Id) throw new AppError('SERVICE_NOT_FOUND', 'Service nicht gefunden.', 404);
  return mapProps(p);
}

function mapProps(p: Record<string, string>): ServiceInfo {
  const mainPid = Number(p.MainPID || 0);
  return {
    name: p.Id,
    description: p.Description || '',
    activeState: p.ActiveState || 'unknown',
    subState: p.SubState || 'unknown',
    unitFileState: p.UnitFileState || 'unknown',
    enabled: ['enabled', 'enabled-runtime', 'static', 'indirect'].includes(p.UnitFileState || ''),
    running: p.ActiveState === 'active',
    mainPid: mainPid > 0 ? mainPid : null,
    activeEnterTimestamp:
      p.ActiveEnterTimestamp && p.ActiveEnterTimestamp !== 'n/a' ? p.ActiveEnterTimestamp : null,
    fragmentPath: p.FragmentPath || null,
  };
}

export async function serviceAction(
  name: string,
  op: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable',
): Promise<void> {
  const unit = assertServiceName(name);
  if (CRITICAL_SERVICES.has(unit) && (op === 'stop' || op === 'disable')) {
    throw new AppError(
      'CRITICAL_SERVICE',
      'Dieser kritische Service darf nicht gestoppt oder deaktiviert werden.',
      403,
    );
  }
  await runHelper({ action: 'service', op, unit });
}

export async function getServiceStatusText(name: string): Promise<string> {
  const unit = assertServiceName(name);
  const result = await execFileSafe('/usr/bin/systemctl', ['status', unit, '--no-pager', '-l'], {
    allowFailure: true,
  });
  return result.stdout || result.stderr;
}

export async function getServiceLogs(name: string, lines = 100): Promise<string[]> {
  const unit = assertServiceName(name);
  const safeLines = Math.min(Math.max(lines, 1), 500);
  const result = await execFileSafe(
    '/usr/bin/journalctl',
    ['-u', unit, '-n', String(safeLines), '-o', 'short-iso', '--no-pager'],
    { allowFailure: true },
  );
  return result.stdout
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
}
