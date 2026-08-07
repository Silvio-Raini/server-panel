import { execFileSafe } from '../../utils/exec.js';
import { assertServiceName } from '../../utils/validate.js';
import { AppError } from '../../utils/errors.js';

export async function getJournalLogs(options: {
  unit?: string;
  since?: string;
  lines?: number;
}): Promise<{ lines: string[]; truncated: boolean }> {
  const lines = Math.min(Math.max(options.lines ?? 100, 1), 500);
  const args = ['-n', String(lines), '-o', 'short-iso', '--no-pager'];

  if (options.unit) {
    args.push('-u', assertServiceName(options.unit));
  }

  if (options.since) {
    // Allow only safe since formats: "1 hour ago", "today", ISO-like, or systemd relative
    if (!/^[a-zA-Z0-9:.\s+-]+$/.test(options.since) || options.since.length > 64) {
      throw new AppError('INVALID_SINCE', 'Ungültiger Zeitraum.', 400);
    }
    args.push('--since', options.since);
  }

  const result = await execFileSafe('/usr/bin/journalctl', args, { allowFailure: true });
  const out = result.stdout
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);

  return { lines: out, truncated: out.length >= lines };
}
