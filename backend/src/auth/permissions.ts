import type { Role } from '../database/db.js';
import { AppError } from '../utils/errors.js';

export type Permission =
  | 'system.read'
  | 'services.read'
  | 'services.manage'
  | 'users.read'
  | 'users.manage'
  | 'groups.read'
  | 'groups.manage'
  | 'processes.read'
  | 'processes.manage'
  | 'logs.read'
  | 'storage.read'
  | 'network.read'
  | 'domains.read'
  | 'domains.manage'
  | 'sftp.read'
  | 'sftp.manage'
  | 'files.read'
  | 'audit.read'
  | 'settings.manage';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'system.read',
    'services.read',
    'services.manage',
    'users.read',
    'users.manage',
    'groups.read',
    'groups.manage',
    'processes.read',
    'processes.manage',
    'logs.read',
    'storage.read',
    'network.read',
    'domains.read',
    'domains.manage',
    'sftp.read',
    'sftp.manage',
    'files.read',
    'audit.read',
    'settings.manage',
  ],
  readonly: [
    'system.read',
    'services.read',
    'users.read',
    'groups.read',
    'processes.read',
    'logs.read',
    'storage.read',
    'network.read',
    'domains.read',
    'sftp.read',
    'files.read',
    'audit.read',
  ],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!roleHas(role, permission)) {
    throw new AppError('FORBIDDEN', 'Keine Berechtigung für diese Aktion.', 403);
  }
}

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
