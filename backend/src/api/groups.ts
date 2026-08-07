import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  setGroupMembers,
} from '../services/groups/groups.js';
import { AppError } from '../utils/errors.js';

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/groups', { preHandler: [loadSession, requireAuth('groups.read')] }, async () => {
    return { success: true, data: listGroups() };
  });

  app.get('/api/groups/:name', { preHandler: [loadSession, requireAuth('groups.read')] }, async (req) => {
    const { name } = req.params as { name: string };
    return { success: true, data: getGroup(name) };
  });

  app.post('/api/groups', { preHandler: [loadSession, requireAuth('groups.manage'), requireCsrf] }, async (req) => {
    const schema = z.object({ name: z.string().min(1).max(32) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    try {
      await createGroup(body.data.name);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'group.create',
        target: body.data.name,
        success: true,
        ip: req.ip,
      });
      return { success: true, data: getGroup(body.data.name) };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'group.create',
        target: body.data.name,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.delete('/api/groups/:name', { preHandler: [loadSession, requireAuth('groups.manage'), requireCsrf] }, async (req) => {
    const { name } = req.params as { name: string };
    const schema = z.object({ confirm: z.literal(true) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
    await deleteGroup(name);
    writeAudit({
      userId: req.auth!.user.id,
      username: req.auth!.user.username,
      action: 'group.delete',
      target: name,
      success: true,
      ip: req.ip,
    });
    return { success: true };
  });

  app.put('/api/groups/:name/members', { preHandler: [loadSession, requireAuth('groups.manage'), requireCsrf] }, async (req) => {
    const { name } = req.params as { name: string };
    const schema = z.object({ members: z.array(z.string()) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    await setGroupMembers(name, body.data.members);
    writeAudit({
      userId: req.auth!.user.id,
      username: req.auth!.user.username,
      action: 'group.members',
      target: name,
      success: true,
      ip: req.ip,
    });
    return { success: true, data: getGroup(name) };
  });
}
