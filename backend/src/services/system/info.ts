import fs from 'node:fs';
import os from 'node:os';
import { execFileSafe } from '../../utils/exec.js';

function readFirstLine(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8').trim().split('\n')[0] ?? '';
  } catch {
    return '';
  }
}

function parseMeminfo(): Record<string, number> {
  const raw = fs.readFileSync('/proc/meminfo', 'utf8');
  const out: Record<string, number> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) out[m[1]] = Number(m[2]) * 1024;
  }
  return out;
}

function cpuUsageSample(): Promise<{ user: number; nice: number; system: number; idle: number; iowait: number }> {
  const parse = () => {
    const line = readFirstLine('/proc/stat');
    const parts = line.split(/\s+/).slice(1).map(Number);
    return {
      user: parts[0] ?? 0,
      nice: parts[1] ?? 0,
      system: parts[2] ?? 0,
      idle: parts[3] ?? 0,
      iowait: parts[4] ?? 0,
    };
  };
  const a = parse();
  return new Promise((resolve) => {
    setTimeout(() => {
      const b = parse();
      resolve({
        user: b.user - a.user,
        nice: b.nice - a.nice,
        system: b.system - a.system,
        idle: b.idle - a.idle,
        iowait: b.iowait - a.iowait,
      });
    }, 200);
  });
}

export async function getSystemInfo() {
  const mem = parseMeminfo();
  const load = os.loadavg();
  const uptimeSec = os.uptime();
  const cpuDelta = await cpuUsageSample();
  const totalCpu =
    cpuDelta.user + cpuDelta.nice + cpuDelta.system + cpuDelta.idle + cpuDelta.iowait || 1;
  const cpuPercent = ((totalCpu - cpuDelta.idle) / totalCpu) * 100;

  let debianVersion = '';
  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    debianVersion = pretty?.[1] ?? '';
  } catch {
    debianVersion = 'Debian';
  }

  let processCount = 0;
  try {
    processCount = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).length;
  } catch {
    processCount = 0;
  }

  let failedServices = 0;
  let activeServices = 0;
  try {
    const failed = await execFileSafe(
      '/usr/bin/systemctl',
      ['--failed', '--no-legend', '--no-pager'],
      { allowFailure: true },
    );
    failedServices = failed.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length;
    const active = await execFileSafe(
      '/usr/bin/systemctl',
      ['list-units', '--type=service', '--state=running', '--no-legend', '--no-pager'],
      { allowFailure: true },
    );
    activeServices = active.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length;
  } catch {
    /* ignore */
  }

  let userCount = 0;
  try {
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    userCount = passwd.split('\n').filter((l) => l && !l.startsWith('#')).length;
  } catch {
    userCount = 0;
  }

  let disks: Array<{
    filesystem: string;
    size: string;
    used: string;
    avail: string;
    usePercent: number;
    mounted: string;
  }> = [];
  try {
    const df = await execFileSafe('/usr/bin/df', ['-hT', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs'], {
      allowFailure: true,
    });
    disks = df.stdout
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((p) => p.length >= 7)
      .map((p) => ({
        filesystem: p[0],
        type: p[1],
        size: p[2],
        used: p[3],
        avail: p[4],
        usePercent: Number(String(p[5]).replace('%', '')) || 0,
        mounted: p[6],
      }));
  } catch {
    disks = [];
  }

  let recentEvents: string[] = [];
  try {
    const journal = await execFileSafe(
      '/usr/bin/journalctl',
      ['-n', '8', '-o', 'short-iso', '--no-pager'],
      { allowFailure: true },
    );
    recentEvents = journal.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-8);
  } catch {
    recentEvents = [];
  }

  const ramTotal = mem.MemTotal ?? 0;
  const ramAvailable = mem.MemAvailable ?? mem.MemFree ?? 0;
  const ramUsed = Math.max(ramTotal - ramAvailable, 0);
  const swapTotal = mem.SwapTotal ?? 0;
  const swapFree = mem.SwapFree ?? 0;
  const swapUsed = Math.max(swapTotal - swapFree, 0);

  return {
    hostname: os.hostname(),
    debianVersion,
    kernel: os.release(),
    arch: os.arch(),
    uptimeSec,
    uptimeHuman: formatUptime(uptimeSec),
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model ?? 'unknown',
      usagePercent: Math.round(cpuPercent * 10) / 10,
    },
    memory: {
      total: ramTotal,
      used: ramUsed,
      available: ramAvailable,
      usagePercent: ramTotal ? Math.round((ramUsed / ramTotal) * 1000) / 10 : 0,
    },
    swap: {
      total: swapTotal,
      used: swapUsed,
      usagePercent: swapTotal ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0,
    },
    loadAverage: {
      '1m': load[0],
      '5m': load[1],
      '15m': load[2],
    },
    processCount,
    time: {
      iso: new Date().toISOString(),
      local: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    },
    overview: {
      activeServices,
      failedServices,
      userCount,
      disks,
      recentEvents,
    },
  };
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
