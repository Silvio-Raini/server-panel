import { execFileSafe, runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import { assertPid } from '../../utils/validate.js';

export interface ProcessInfo {
  pid: number;
  user: string;
  name: string;
  cpu: number;
  mem: number;
  start: string;
  command: string;
}

export async function listProcesses(sortBy: 'cpu' | 'mem' | 'pid' | 'user' = 'cpu'): Promise<ProcessInfo[]> {
  const result = await execFileSafe(
    '/usr/bin/ps',
    ['-eo', 'pid,user,pcpu,pmem,lstart,comm,args', '--no-headers'],
    { allowFailure: true },
  );

  const rows: ProcessInfo[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    // pid user pcpu pmem lstart(5 fields) comm args...
    const m = line.trim().match(
      /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\S+)\s+(.*)$/,
    );
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      user: m[2],
      cpu: Number(m[3]),
      mem: Number(m[4]),
      start: m[5],
      name: m[6],
      command: m[7],
    });
  }

  rows.sort((a, b) => {
    switch (sortBy) {
      case 'mem':
        return b.mem - a.mem;
      case 'pid':
        return a.pid - b.pid;
      case 'user':
        return a.user.localeCompare(b.user);
      case 'cpu':
      default:
        return b.cpu - a.cpu;
    }
  });

  return rows.slice(0, 500);
}

export async function signalProcess(pid: number, signal: 'TERM' | 'KILL'): Promise<void> {
  const safePid = assertPid(pid);
  if (safePid === process.pid) {
    throw new AppError('PROTECTED_PROCESS', 'Der Panel-Prozess kann nicht beendet werden.', 403);
  }
  await runHelper({ action: 'process.signal', pid: safePid, signal });
}
