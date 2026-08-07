import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSession, requireAuth } from '../middleware/auth.js';
import { listDirectory, listRoots, readFileContent } from '../services/files/viewer.js';
import { AppError } from '../utils/errors.js';

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/files/roots', { preHandler: [loadSession, requireAuth('files.read')] }, async () => {
    return { success: true, data: listRoots() };
  });

  app.get('/api/files', { preHandler: [loadSession, requireAuth('files.read')] }, async (req) => {
    const schema = z.object({
      path: z.string().min(1).max(1000),
    });
    const query = schema.safeParse(req.query);
    if (!query.success) throw new AppError('VALIDATION_ERROR', 'Pfad fehlt oder ist ungültig.', 400);
    const data = await listDirectory(query.data.path);
    return { success: true, data };
  });

  app.get('/api/files/content', { preHandler: [loadSession, requireAuth('files.read')] }, async (req) => {
    const schema = z.object({
      path: z.string().min(1).max(1000),
    });
    const query = schema.safeParse(req.query);
    if (!query.success) throw new AppError('VALIDATION_ERROR', 'Pfad fehlt oder ist ungültig.', 400);
    const data = await readFileContent(query.data.path);
    return { success: true, data };
  });
}
