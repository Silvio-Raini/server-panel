import { describe, expect, it } from 'vitest';
import { roleHas } from '../../backend/src/auth/permissions.js';
import { AppError } from '../../backend/src/utils/errors.js';
import { assertUsername } from '../../backend/src/utils/validate.js';

describe('sftp guards', () => {
  it('enforces sftp permissions', () => {
    expect(roleHas('admin', 'sftp.manage')).toBe(true);
    expect(roleHas('readonly', 'sftp.read')).toBe(true);
    expect(roleHas('readonly', 'sftp.manage')).toBe(false);
  });

  it('rejects unsafe usernames before sftp prefix check layer', () => {
    expect(assertUsername('sftp_kunde1')).toBe('sftp_kunde1');
    expect(() => assertUsername('root;id')).toThrow(AppError);
    expect(() => assertUsername('../admin')).toThrow(AppError);
  });
});
