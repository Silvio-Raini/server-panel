import { describe, expect, it } from 'vitest';
import {
  assertDeletablePath,
  assertFsPath,
  assertWritablePath,
} from '../../backend/src/services/files/viewer.js';
import { AppError } from '../../backend/src/utils/errors.js';
import { roleHas } from '../../backend/src/auth/permissions.js';

describe('file manager security', () => {
  it('allows full filesystem browse paths from /', () => {
    expect(assertFsPath('/')).toBe('/');
    expect(assertFsPath('/etc/nginx/nginx.conf')).toBe('/etc/nginx/nginx.conf');
    expect(assertFsPath('/var/www/../www/index.html')).toBe('/var/www/index.html');
  });

  it('blocks traversal tricks', () => {
    expect(() => assertFsPath('etc/passwd')).toThrow(AppError);
    expect(() => assertFsPath('/tmp/\0x')).toThrow(AppError);
  });

  it('blocks writes to virtual filesystems', () => {
    expect(() => assertWritablePath('/proc/self/status')).toThrow(AppError);
    expect(() => assertWritablePath('/sys/class')).toThrow(AppError);
    expect(assertWritablePath('/var/www/test.txt')).toBe('/var/www/test.txt');
  });

  it('protects critical mountpoints from deletion', () => {
    expect(() => assertDeletablePath('/')).toThrow(AppError);
    expect(() => assertDeletablePath('/etc')).toThrow(AppError);
    expect(() => assertDeletablePath('/var')).toThrow(AppError);
    expect(assertDeletablePath('/var/www/old-site')).toBe('/var/www/old-site');
  });

  it('separates read and manage permissions', () => {
    expect(roleHas('admin', 'files.manage')).toBe(true);
    expect(roleHas('readonly', 'files.read')).toBe(true);
    expect(roleHas('readonly', 'files.manage')).toBe(false);
  });
});
