import { describe, expect, it } from 'vitest';
import { assertPermission, roleHas } from '../../backend/src/auth/permissions.js';
import { AppError } from '../../backend/src/utils/errors.js';

describe('permissions', () => {
  it('allows admin privileged actions', () => {
    expect(roleHas('admin', 'services.manage')).toBe(true);
    expect(roleHas('admin', 'users.manage')).toBe(true);
    expect(() => assertPermission('admin', 'services.manage')).not.toThrow();
  });

  it('blocks readonly privileged actions', () => {
    expect(roleHas('readonly', 'services.read')).toBe(true);
    expect(roleHas('readonly', 'services.manage')).toBe(false);
    expect(() => assertPermission('readonly', 'users.manage')).toThrow(AppError);
    expect(() => assertPermission('readonly', 'processes.manage')).toThrow(AppError);
  });
});
