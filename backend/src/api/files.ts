import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  createDirectory,
  createFile,
  deletePath,
  listDirectory,
  listRoots,
  readFileContent,
  renamePath,
  writeFileContent,
} from '../services/files/viewer.js';
import { AppError } from '../utils/errors.js';

async function audited(
  req: { auth?: { user: { id: number; username: string } }; ip: string },
  action: string,
  target: string,
  fn: () => Promise<unknown>,
) {
  try {
    const data = await fn();
    writeAudit({
      userId: req.auth!.user.id,
      username: req.auth!.user.username,
      action,
      target,
      success: true,
      ip: req.ip,
    });
    return { success: true, data };
  } catch (err) {
    writeAudit({
      userId: req.auth!.user.id,
      username: req.auth!.user.username,
      action,
      target,
      success: false,
      message: err instanceof Error ? err.message : 'error',
      ip: req.ip,
    });
    throw err;
  }
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files/roots', { preHandler: [loadSession, requireAuth('files.read')] }, async () => {
    return { success: true, data: listRoots() };
  });

  app.get('/api/files', { preHandler: [loadSession, requireAuth('files.read')] }, async (req) => {
    const schema = z.object({ path: z.string().min(1).max(1024).default('/') });
    const query = schema.safeParse(req.query);
    if (!query.success) throw new AppError('VALIDATION_ERROR', 'Pfad fehlt oder ist ungültig.', 400);
    return { success: true, data: await listDirectory(query.data.path) };
  });

  app.get('/api/files/content', { preHandler: [loadSession, requireAuth('files.read')] }, async (req) => {
    const schema = z.object({ path: z.string().min(1).max(1024) });
    const query = schema.safeParse(req.query);
    if (!query.success) throw new AppError('VALIDATION_ERROR', 'Pfad fehlt oder ist ungültig.', 400);
    return { success: true, data: await readFileContent(query.data.path) };
  });

  app.put('/api/files/content', {
    preHandler: [loadSession, requireAuth('files.manage'), requireCsrf],
  }, async (req) => {
    const schema = z.object({
      path: z.string().min(1).max(1024),
      content: z.string(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return audited(req, 'files.write', body.data.path, () =>
      writeFileContent(body.data.path, body.data.content),
    );
  });

  app.post('/api/files', {
    preHandler: [loadSession, requireAuth('files.manage'), requireCsrf],
  }, async (req) => {
    const schema = z.object({
      path: z.string().min(1).max(1024),
      type: z.enum(['file', 'dir']),
      content: z.string().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return audited(req, `files.create.${body.data.type}`, body.data.path, async () => {
      if (body.data.type === 'dir') return createDirectory(body.data.path);
      return createFile(body.data.path, body.data.content || '');
    });
  });

  app.post('/api/files/rename', {
    preHandler: [loadSession, requireAuth('files.manage'), requireCsrf],
  }, async (req) => {
    const schema = z.object({
      from: z.string().min(1).max(1024),
      to: z.string().min(1).max(1024),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return audited(req, 'files.rename', `${body.data.from} -> ${body.data.to}`, () =>
      renamePath(body.data.from, body.data.to),
    );
  });

  app.delete('/api/files', {
    preHandler: [loadSession, requireAuth('files.manage'), requireCsrf],
  }, async (req) => {
    const schema = z.object({
      path: z.string().min(1).max(1024),
      confirm: z.literal(true),
      recursive: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
    return audited(req, 'files.delete', body.data.path, async () => {
      await deletePath(body.data.path, body.data.recursive === true);
      return { path: body.data.path };
    });
  });
}
