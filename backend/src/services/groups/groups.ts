import fs from 'node:fs';
import { runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import {
  PROTECTED_GROUPS,
  assertGroupName,
  assertNotProtectedGroup,
  assertUsername,
} from '../../utils/validate.js';

export interface LinuxGroup {
  name: string;
  gid: number;
  members: string[];
  protected: boolean;
}

export function listGroups(): LinuxGroup[] {
  return fs
    .readFileSync('/etc/group', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const [name, , gid, members] = line.split(':');
      return {
        name,
        gid: Number(gid),
        members: members ? members.split(',').filter(Boolean) : [],
        protected: PROTECTED_GROUPS.has(name) || name.startsWith('systemd-') || Number(gid) < 1000,
      };
    })
    .sort((a, b) => a.gid - b.gid);
}

export function getGroup(name: string): LinuxGroup {
  const g = listGroups().find((x) => x.name === assertGroupName(name));
  if (!g) throw new AppError('GROUP_NOT_FOUND', 'Gruppe nicht gefunden.', 404);
  return g;
}

export async function createGroup(name: string): Promise<void> {
  const g = assertGroupName(name);
  assertNotProtectedGroup(g);
  await runHelper({ action: 'group.create', name: g });
}

export async function deleteGroup(name: string): Promise<void> {
  const g = assertGroupName(name);
  assertNotProtectedGroup(g);
  const group = getGroup(g);
  if (group.protected) {
    throw new AppError('PROTECTED_GROUP', 'Diese Gruppe ist geschützt.', 403);
  }
  // Prevent deleting primary groups still in use
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  for (const line of passwd.split('\n')) {
    if (!line) continue;
    const parts = line.split(':');
    if (Number(parts[3]) === group.gid) {
      throw new AppError(
        'GROUP_IN_USE',
        `Gruppe ist primäre Gruppe von Benutzer "${parts[0]}" und kann nicht gelöscht werden.`,
        409,
      );
    }
  }
  await runHelper({ action: 'group.delete', name: g });
}

export async function setGroupMembers(name: string, members: string[]): Promise<void> {
  const g = getGroup(name);
  if (g.protected && g.gid < 100) {
    throw new AppError('PROTECTED_GROUP', 'Mitglieder kritischer Systemgruppen sind geschützt.', 403);
  }
  const desired = new Set(members.map(assertUsername));
  const current = new Set(g.members);
  for (const user of desired) {
    if (!current.has(user)) {
      await runHelper({ action: 'user.addGroup', username: user, group: g.name });
    }
  }
  for (const user of current) {
    if (!desired.has(user)) {
      await runHelper({ action: 'user.removeGroup', username: user, group: g.name });
    }
  }
}
