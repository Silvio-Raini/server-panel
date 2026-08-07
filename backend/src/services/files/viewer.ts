import path from 'node:path';
import { runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';

export const FILE_SHORTCUTS = [
  '/',
  '/var/www',
  '/opt/sites',
  '/srv/www',
  '/var/sftp',
  '/var/log',
  '/etc',
  '/home',
  '/opt',
  '/tmp',
] as const;

/** Exact paths that must never be deleted. */
export const PROTECTED_DELETE_PATHS = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/home',
  '/lib',
  '/lib64',
  '/lost+found',
  '/media',
  '/mnt',
  '/opt',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
]);

const VIRTUAL_WRITE_BLOCK_PREFIXES = ['/proc', '/sys', '/dev'];

const MAX_TEXT_BYTES = 1_048_576;
const MAX_WRITE_BYTES = 2_000_000;
const MAX_LIST_ENTRIES = 1000;

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtime: string | null;
  mode: string;
  readable: boolean;
}

export interface FileContent {
  path: string;
  name: string;
  size: number;
  mtime: string | null;
  encoding: 'utf-8' | 'base64' | 'none';
  mime: string;
  truncated: boolean;
  content: string | null;
  isText: boolean;
  isImage: boolean;
  editable: boolean;
}

export function assertFsPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new AppError('INVALID_PATH', 'Ungültiger Pfad.', 400);
  }
  if (inputPath.includes('\0')) {
    throw new AppError('INVALID_PATH', 'Ungültiger Pfad.', 400);
  }

  let normalized = path.posix.normalize(inputPath.replace(/\\/g, '/'));
  if (!normalized.startsWith('/')) {
    throw new AppError('INVALID_PATH', 'Pfad muss absolut sein.', 400);
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.split('/').includes('..')) {
    throw new AppError('INVALID_PATH', 'Pfadtraversal ist nicht erlaubt.', 400);
  }
  if (normalized.length > 1024) {
    throw new AppError('INVALID_PATH', 'Pfad ist zu lang.', 400);
  }
  return normalized;
}

/** @deprecated use assertFsPath */
export const assertViewerPath = assertFsPath;

export function assertWritablePath(inputPath: string): string {
  const target = assertFsPath(inputPath);
  if (VIRTUAL_WRITE_BLOCK_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`))) {
    throw new AppError('PATH_NOT_WRITABLE', 'In /proc, /sys und /dev kann nicht geschrieben werden.', 403);
  }
  return target;
}

export function assertDeletablePath(inputPath: string): string {
  const target = assertWritablePath(inputPath);
  if (PROTECTED_DELETE_PATHS.has(target)) {
    throw new AppError('PATH_PROTECTED', 'Dieser Systempfad ist vor Löschung geschützt.', 403);
  }
  return target;
}

export function listRoots() {
  return FILE_SHORTCUTS.map((root) => ({
    path: root,
    label: root === '/' ? '/ (Root)' : root,
  }));
}

export async function listDirectory(rawPath: string): Promise<{
  path: string;
  parent: string | null;
  entries: FileEntry[];
}> {
  const target = assertFsPath(rawPath || '/');
  const result = (await runHelper({
    action: 'files.list',
    path: target,
  })) as {
    path?: string;
    parent?: string | null;
    entries?: FileEntry[];
  };

  const entries = (result.entries || [])
    .filter((e) => e.name && e.name !== '.' && e.name !== '..')
    .slice(0, MAX_LIST_ENTRIES)
    .sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

  return {
    path: result.path || target,
    parent: target === '/' ? null : result.parent ?? path.posix.dirname(target),
    entries,
  };
}

export async function readFileContent(rawPath: string): Promise<FileContent> {
  const target = assertFsPath(rawPath);
  if (target === '/') {
    throw new AppError('NOT_A_FILE', 'Verzeichnisse können nicht als Datei gelesen werden.', 400);
  }

  const result = (await runHelper({
    action: 'files.read',
    path: target,
    maxBytes: MAX_TEXT_BYTES,
  })) as FileContent;

  const editable =
    Boolean(result.isText) &&
    !VIRTUAL_WRITE_BLOCK_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`)) &&
    !result.truncated &&
    result.size <= MAX_WRITE_BYTES;

  return {
    path: result.path || target,
    name: result.name || path.posix.basename(target),
    size: result.size || 0,
    mtime: result.mtime || null,
    encoding: result.encoding || 'none',
    mime: result.mime || 'application/octet-stream',
    truncated: Boolean(result.truncated),
    content: result.content ?? null,
    isText: Boolean(result.isText),
    isImage: Boolean(result.isImage),
    editable,
  };
}

export async function writeFileContent(rawPath: string, content: string): Promise<FileContent> {
  const target = assertWritablePath(rawPath);
  if (typeof content !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'Inhalt fehlt.', 400);
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw new AppError('FILE_TOO_LARGE', `Datei darf maximal ${MAX_WRITE_BYTES} Bytes haben.`, 400);
  }

  await runHelper({
    action: 'files.write',
    path: target,
    content,
  });
  return readFileContent(target);
}

export async function createFile(rawPath: string, content = ''): Promise<FileContent> {
  const target = assertWritablePath(rawPath);
  await runHelper({
    action: 'files.create',
    path: target,
    content,
  });
  return readFileContent(target);
}

export async function createDirectory(rawPath: string): Promise<{ path: string }> {
  const target = assertWritablePath(rawPath);
  await runHelper({
    action: 'files.mkdir',
    path: target,
  });
  return { path: target };
}

export async function deletePath(rawPath: string, recursive = false): Promise<void> {
  const target = assertDeletablePath(rawPath);
  await runHelper({
    action: 'files.delete',
    path: target,
    recursive: Boolean(recursive),
  });
}

export async function renamePath(fromRaw: string, toRaw: string): Promise<{ path: string }> {
  const from = assertDeletablePath(fromRaw);
  const to = assertWritablePath(toRaw);
  await runHelper({
    action: 'files.rename',
    from,
    to,
  });
  return { path: to };
}
