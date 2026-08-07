import { describe, expect, it } from 'vitest';
import { assertViewerPath } from '../../backend/src/services/files/viewer.js';
import { AppError } from '../../backend/src/utils/errors.js';
import { roleHas } from '../../backend/src/auth/permissions.js';

describe('file viewer security', () => {
  it('allows only configured roots', () => {
    expect(assertViewerPath('/var/www')).toBe('/var/www');
    expect(assertViewerPath('/var/www/site/index.html')).toBe('/var/www/site/index.html');
    expect(assertViewerPath('/var/sftp/sftp_demo/data')).toBe('/var/sftp/sftp_demo/data');
  });

  it('blocks path traversal and sensitive files', () => {
    expect(() => assertViewerPath('/etc/passwd')).toThrow(AppError);
    expect(() => assertViewerPath('/var/www/../etc/passwd')).toThrow(AppError);
    expect(() => assertViewerPath('/var/www/../../root/.ssh/id_rsa')).toThrow(AppError);
    expect(() => assertViewerPath('/var/www/.env')).toThrow(AppError);
    expect(() => assertViewerPath('/var/www/secret.panel.db')).toThrow(AppError);
  });

  it('grants read permission to admin and readonly', () => {
    expect(roleHas('admin', 'files.read')).toBe(true);
    expect(roleHas('readonly', 'files.read')).toBe(true);
  });
});
