import { describe, expect, it } from 'vitest';
import {
  assertServiceName,
  assertUsername,
  assertGroupName,
  assertPid,
  assertNotProtectedUser,
  assertNotProtectedGroup,
} from '../../backend/src/utils/validate.js';
import { AppError } from '../../backend/src/utils/errors.js';

describe('input validation', () => {
  it('accepts valid service names', () => {
    expect(assertServiceName('nginx')).toBe('nginx.service');
    expect(assertServiceName('nginx.service')).toBe('nginx.service');
  });

  it('rejects command injection in service names', () => {
    expect(() => assertServiceName('nginx;reboot')).toThrow(AppError);
    expect(() => assertServiceName('../../etc/passwd')).toThrow(AppError);
    expect(() => assertServiceName('nginx && id')).toThrow(AppError);
    expect(() => assertServiceName('$(reboot)')).toThrow(AppError);
  });

  it('validates usernames', () => {
    expect(assertUsername('deploy')).toBe('deploy');
    expect(() => assertUsername('root;id')).toThrow(AppError);
    expect(() => assertUsername('../admin')).toThrow(AppError);
  });

  it('protects system users and groups', () => {
    expect(() => assertNotProtectedUser('root')).toThrow(AppError);
    expect(() => assertNotProtectedUser('www-data')).toThrow(AppError);
    expect(() => assertNotProtectedGroup('sudo')).toThrow(AppError);
  });

  it('validates PIDs', () => {
    expect(assertPid(42)).toBe(42);
    expect(() => assertPid(1)).toThrow(AppError);
    expect(() => assertPid(-5)).toThrow(AppError);
  });

  it('validates group names', () => {
    expect(assertGroupName('developers')).toBe('developers');
    expect(() => assertGroupName('devs;rm -rf /')).toThrow(AppError);
  });
});
