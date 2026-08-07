import { describe, expect, it } from 'vitest';
import {
  assertDomainName,
  assertProxyTarget,
  assertRedirectTarget,
  assertStaticRoot,
} from '../../backend/src/utils/validate.js';
import { AppError } from '../../backend/src/utils/errors.js';
import { roleHas } from '../../backend/src/auth/permissions.js';

describe('domain validation', () => {
  it('accepts valid domains', () => {
    expect(assertDomainName('App.Example.com')).toBe('app.example.com');
  });

  it('rejects injection in domain names', () => {
    expect(() => assertDomainName('evil.com;rm -rf /')).toThrow(AppError);
    expect(() => assertDomainName('../etc')).toThrow(AppError);
    expect(() => assertDomainName('not a domain')).toThrow(AppError);
  });

  it('normalizes proxy targets to localhost', () => {
    expect(assertProxyTarget('8080')).toBe('127.0.0.1:8080');
    expect(assertProxyTarget('localhost:3001')).toBe('127.0.0.1:3001');
    expect(() => assertProxyTarget('8.8.8.8:80')).toThrow(AppError);
    expect(() => assertProxyTarget('22')).toThrow(AppError);
  });

  it('allows only safe static roots', () => {
    expect(assertStaticRoot('/var/www/site')).toBe('/var/www/site');
    expect(() => assertStaticRoot('/etc/nginx')).toThrow(AppError);
    expect(() => assertStaticRoot('/var/www/../etc')).toThrow(AppError);
  });

  it('validates redirect URLs', () => {
    expect(assertRedirectTarget('https://example.com/path')).toContain('https://example.com/path');
    expect(() => assertRedirectTarget('ftp://x')).toThrow(AppError);
  });

  it('enforces domain permissions', () => {
    expect(roleHas('admin', 'domains.manage')).toBe(true);
    expect(roleHas('readonly', 'domains.read')).toBe(true);
    expect(roleHas('readonly', 'domains.manage')).toBe(false);
  });
});
