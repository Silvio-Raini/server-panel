import fs from 'node:fs';
import { execFileSafe } from '../../utils/exec.js';

export interface NetInterface {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string | null;
  state: string;
  rxBytes: number;
  txBytes: number;
}

export async function getNetworkOverview() {
  const interfaces = await listInterfaces();
  const routes = await listRoutes();
  const dns = await listDns();
  const gateway = routes.find((r) => r.destination === 'default')?.gateway || null;
  let publicIp: string | null = null;
  try {
    const result = await execFileSafe(
      '/usr/bin/curl',
      ['-4', '-s', '--max-time', '3', 'https://ifconfig.me'],
      { allowFailure: true, timeoutMs: 5000 },
    );
    const ip = result.stdout.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) publicIp = ip;
  } catch {
    publicIp = null;
  }

  return { interfaces, routes, dns, gateway, publicIp };
}

async function listInterfaces(): Promise<NetInterface[]> {
  const ipJson = await execFileSafe('/usr/bin/ip', ['-j', 'addr'], { allowFailure: true });
  let parsed: Array<{
    ifname: string;
    operstate?: string;
    address?: string;
    addr_info?: Array<{ family: string; local: string }>;
  }> = [];
  try {
    parsed = JSON.parse(ipJson.stdout);
  } catch {
    parsed = [];
  }

  return parsed
    .filter((i) => i.ifname !== 'lo')
    .map((i) => {
      const statsPath = `/sys/class/net/${i.ifname}/statistics`;
      let rxBytes = 0;
      let txBytes = 0;
      try {
        rxBytes = Number(fs.readFileSync(`${statsPath}/rx_bytes`, 'utf8'));
        txBytes = Number(fs.readFileSync(`${statsPath}/tx_bytes`, 'utf8'));
      } catch {
        /* ignore */
      }
      return {
        name: i.ifname,
        ipv4: (i.addr_info || []).filter((a) => a.family === 'inet').map((a) => a.local),
        ipv6: (i.addr_info || []).filter((a) => a.family === 'inet6').map((a) => a.local),
        mac: i.address || null,
        state: i.operstate || 'unknown',
        rxBytes,
        txBytes,
      };
    });
}

async function listRoutes() {
  const result = await execFileSafe('/usr/bin/ip', ['-j', 'route'], { allowFailure: true });
  try {
    const parsed = JSON.parse(result.stdout) as Array<{
      dst?: string;
      gateway?: string;
      dev?: string;
      protocol?: string;
    }>;
    return parsed.map((r) => ({
      destination: r.dst || 'default',
      gateway: r.gateway || null,
      device: r.dev || null,
      protocol: r.protocol || null,
    }));
  } catch {
    return [];
  }
}

async function listDns(): Promise<string[]> {
  try {
    const resolvectl = await execFileSafe('/usr/bin/resolvectl', ['dns'], { allowFailure: true });
    const ips = [...resolvectl.stdout.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].map((m) => m[0]);
    if (ips.length) return [...new Set(ips)];
  } catch {
    /* fallthrough */
  }
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
    return [...resolv.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}
