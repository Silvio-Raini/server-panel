import { execFileSafe } from '../../utils/exec.js';

export interface MountInfo {
  filesystem: string;
  type: string;
  size: string;
  used: string;
  free: string;
  usagePercent: number;
  mount: string;
}

export async function listStorage(): Promise<MountInfo[]> {
  const result = await execFileSafe(
    '/usr/bin/df',
    ['-hT', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay'],
    { allowFailure: true },
  );

  return result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((p) => p.length >= 7)
    .map((p) => ({
      filesystem: p[0],
      type: p[1],
      size: p[2],
      used: p[3],
      free: p[4],
      usagePercent: Number(String(p[5]).replace('%', '')) || 0,
      mount: p[6],
    }));
}
