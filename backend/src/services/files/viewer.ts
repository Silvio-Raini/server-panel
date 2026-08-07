import path from 'node:path';
import { runHelper } from '../../utils/exec.js';
import { AppError } from '../../utils/errors.js';

export const FILE_VIEWER_ROOTS = [
  '/var/www',
  '/opt/sites',
  '/srv/www',
  '/var/sftp',
  '/var/log',
] as const;

const BLOCKED_NAME_RE =
  /(\.env($|\.)|^\.git$|id_rsa|id_ed25519|privkey\.pem|panel\.db|\.sqlite($|\-)|htpasswd|shadow)/i;

const MAX_TEXT_BYTES = 512_000;
const MAX_LIST_ENTRIES = 500;

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
}

function isBlockedName(name: string): boolean {
  return BLOCKED_NAME_RE.test(name);
}

export function assertViewerPath(inputPath: string): string {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new AppError('INVALID_PATH', 'Ungültiger Pfad.', 400);
  }
  if (inputPath.includes('\0') || inputPath.includes('\\')) {
    throw new AppError('INVALID_PATH', 'Ungültiger Pfad.', 400);
  }

  // Normalize but keep absolute
  let normalized = path.posix.normalize(inputPath.replace(/\\/g, '/'));
  if (!normalized.startsWith('/')) {
    throw new AppError('INVALID_PATH', 'Pfad muss absolut sein.', 400);
  }
  // Remove trailing slash except root-like
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  const allowed = FILE_VIEWER_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
  if (!allowed) {
    throw new AppError(
      'PATH_NOT_ALLOWED',
      `Pfad liegt außerhalb erlaubter Wurzeln: ${FILE_VIEWER_ROOTS.join(', ')}`,
      403,
    );
  }

  const base = path.posix.basename(normalized);
  if (base !== '/' && isBlockedName(base)) {
    throw new AppError('PATH_BLOCKED', 'Diese Datei ist aus Sicherheitsgründen gesperrt.', 403);
  }

  // Block hidden traversal segments already handled by normalize; block /../ leftovers
  if (normalized.split('/').includes('..')) {
    throw new AppError('INVALID_PATH', 'Pfadtraversal ist nicht erlaubt.', 400);
  }

  return normalized;
}

export function listRoots() {
  return FILE_VIEWER_ROOTS.map((root) => ({
    path: root,
    label: root,
  }));
}

export async function listDirectory(rawPath: string): Promise<{
  path: string;
  parent: string | null;
  entries: FileEntry[];
}> {
  const target = assertViewerPath(rawPath);
  const result = (await runHelper({
    action: 'files.list',
    path: target,
  })) as {
    ok?: boolean;
    path?: string;
    parent?: string | null;
    entries?: FileEntry[];
    error?: string;
  };

  const entries = (result.entries || [])
    .filter((e) => e.name && e.name !== '.' && e.name !== '..')
    .filter((e) => !isBlockedName(e.name))
    .slice(0, MAX_LIST_ENTRIES)
    .sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

  return {
    path: result.path || target,
    parent: result.parent ?? parentPath(target),
    entries,
  };
}

export async function readFileContent(rawPath: string): Promise<FileContent> {
  const target = assertViewerPath(rawPath);
  if (target === '/' || FILE_VIEWER_ROOTS.includes(target as (typeof FILE_VIEWER_ROOTS)[number])) {
    throw new AppError('NOT_A_FILE', 'Verzeichnisse können nicht als Datei gelesen werden.', 400);
  }

  const result = (await runHelper({
    action: 'files.read',
    path: target,
    maxBytes: MAX_TEXT_BYTES,
  })) as FileContent & { ok?: boolean; error?: string };

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
  };
}

function parentPath(p: string): string | null {
  if (FILE_VIEWER_ROOTS.includes(p as (typeof FILE_VIEWER_ROOTS)[number])) return null;
  const parent = path.posix.dirname(p);
  try {
    assertViewerPath(parent);
    return parent;
  } catch {
    return null;
  }
}
