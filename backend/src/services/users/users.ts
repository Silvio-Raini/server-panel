import fs from 'node:fs';
import { execFileSafe, runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';
import {
  PROTECTED_USERS,
  assertGroupName,
  assertNotProtectedUser,
  assertShell,
  assertUsername,
} from '../../utils/validate.js';

export interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  primaryGroup: string;
  gecos: string;
  home: string;
  shell: string;
  locked: boolean;
  lastLogin: string | null;
  groups: string[];
  system: boolean;
}

function readPasswd(): Array<{
  username: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}> {
  return fs
    .readFileSync('/etc/passwd', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((line) => {
      const [username, , uid, gid, gecos, home, shell] = line.split(':');
      return {
        username,
        uid: Number(uid),
        gid: Number(gid),
        gecos: gecos || '',
        home: home || '',
        shell: shell || '',
      };
    });
}

function readGroupMap(): { byGid: Map<number, string>; members: Map<string, string[]> } {
  const byGid = new Map<number, string>();
  const members = new Map<string, string[]>();
  for (const line of fs.readFileSync('/etc/group', 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [name, , gid, memberStr] = line.split(':');
    byGid.set(Number(gid), name);
    members.set(name, memberStr ? memberStr.split(',').filter(Boolean) : []);
  }
  return { byGid, members };
}

function isLocked(username: string): boolean {
  try {
    const shadow = fs.readFileSync('/etc/shadow', 'utf8');
    const line = shadow.split('\n').find((l) => l.startsWith(`${username}:`));
    if (!line) return false;
    const hash = line.split(':')[1] || '';
    return hash.startsWith('!') || hash.startsWith('*') || hash === '';
  } catch {
    return false;
  }
}

async function lastLogins(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const result = await execFileSafe('/usr/bin/lastlog', ['-t', '3650'], { allowFailure: true });
    for (const line of result.stdout.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const user = parts[0];
      if (line.includes('Never logged in')) map.set(user, null as unknown as string);
      else map.set(user, line.slice(user.length).trim());
    }
  } catch {
    /* ignore */
  }
  return map;
}

export async function listUsers(): Promise<LinuxUser[]> {
  const { byGid, members } = readGroupMap();
  const logins = await lastLogins();
  return readPasswd().map((u) => {
    const groups = [...members.entries()]
      .filter(([, list]) => list.includes(u.username))
      .map(([g]) => g);
    const primary = byGid.get(u.gid) || String(u.gid);
    if (!groups.includes(primary)) groups.unshift(primary);
    return {
      username: u.username,
      uid: u.uid,
      gid: u.gid,
      primaryGroup: primary,
      gecos: u.gecos,
      home: u.home,
      shell: u.shell,
      locked: isLocked(u.username),
      lastLogin: logins.get(u.username) || null,
      groups,
      system: u.uid < 1000 || PROTECTED_USERS.has(u.username),
    };
  });
}

export async function getUser(username: string): Promise<LinuxUser> {
  assertUsername(username);
  const all = await listUsers();
  const user = all.find((u) => u.username === username);
  if (!user) throw new AppError('USER_NOT_FOUND', 'Benutzer nicht gefunden.', 404);
  return user;
}

export async function createUser(input: {
  username: string;
  password: string;
  shell?: string;
  home?: string;
  groups?: string[];
}): Promise<void> {
  const username = assertUsername(input.username);
  assertNotProtectedUser(username);
  if (!input.password || input.password.length < 8) {
    throw new AppError('WEAK_PASSWORD', 'Passwort muss mindestens 8 Zeichen haben.', 400);
  }
  const shell = input.shell ? assertShell(input.shell) : '/bin/bash';
  const groups = (input.groups || []).map(assertGroupName);
  await runHelper({
    action: 'user.create',
    username,
    password: input.password,
    shell,
    home: input.home,
    groups,
  });
}

export async function deleteUser(username: string, removeHome: boolean): Promise<void> {
  const u = assertUsername(username);
  assertNotProtectedUser(u);
  const user = await getUser(u);
  if (user.uid < 1000) {
    throw new AppError('PROTECTED_USER', 'Systembenutzer können nicht gelöscht werden.', 403);
  }
  await runHelper({ action: 'user.delete', username: u, removeHome });
}

export async function lockUser(username: string): Promise<void> {
  const u = assertUsername(username);
  assertNotProtectedUser(u);
  await runHelper({ action: 'user.lock', username: u });
}

export async function unlockUser(username: string): Promise<void> {
  const u = assertUsername(username);
  assertNotProtectedUser(u);
  await runHelper({ action: 'user.unlock', username: u });
}

export async function resetPassword(username: string, password: string): Promise<void> {
  const u = assertUsername(username);
  assertNotProtectedUser(u);
  if (!password || password.length < 8) {
    throw new AppError('WEAK_PASSWORD', 'Passwort muss mindestens 8 Zeichen haben.', 400);
  }
  await runHelper({ action: 'user.passwd', username: u, password });
}

export async function modifyUser(
  username: string,
  patch: { shell?: string; home?: string; primaryGroup?: string },
): Promise<void> {
  const u = assertUsername(username);
  assertNotProtectedUser(u);
  await runHelper({
    action: 'user.modify',
    username: u,
    shell: patch.shell ? assertShell(patch.shell) : undefined,
    home: patch.home,
    primaryGroup: patch.primaryGroup ? assertGroupName(patch.primaryGroup) : undefined,
  });
}

export async function addUserToGroup(username: string, group: string): Promise<void> {
  await runHelper({
    action: 'user.addGroup',
    username: assertUsername(username),
    group: assertGroupName(group),
  });
}

export async function removeUserFromGroup(username: string, group: string): Promise<void> {
  await runHelper({
    action: 'user.removeGroup',
    username: assertUsername(username),
    group: assertGroupName(group),
  });
}
