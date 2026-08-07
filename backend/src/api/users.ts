import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  addUserToGroup,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  lockUser,
  modifyUser,
  removeUserFromGroup,
  resetPassword,
  unlockUser,
} from '../services/users/users.js';
import { AppError } from '../utils/errors.js';

async function wrap(
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

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', { preHandler: [loadSession, requireAuth('users.read')] }, async () => {
    return { success: true, data: await listUsers() };
  });

  app.get('/api/users/:username', { preHandler: [loadSession, requireAuth('users.read')] }, async (req) => {
    const { username } = req.params as { username: string };
    return { success: true, data: await getUser(username) };
  });

  app.post('/api/users', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const schema = z.object({
      username: z.string().min(1).max(32),
      password: z.string().min(8).max(200),
      shell: z.string().optional(),
      home: z.string().optional(),
      groups: z.array(z.string()).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return wrap(req, 'user.create', body.data.username, async () => {
      await createUser(body.data);
      return await getUser(body.data.username);
    });
  });

  app.put('/api/users/:username', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    const schema = z.object({
      shell: z.string().optional(),
      home: z.string().optional(),
      primaryGroup: z.string().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return wrap(req, 'user.modify', username, async () => {
      await modifyUser(username, body.data);
      return await getUser(username);
    });
  });

  app.delete('/api/users/:username', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    const schema = z.object({ confirm: z.literal(true), removeHome: z.boolean().default(false) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
    return wrap(req, 'user.delete', username, async () => {
      await deleteUser(username, body.data.removeHome);
    });
  });

  app.post('/api/users/:username/lock', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    return wrap(req, 'user.lock', username, async () => lockUser(username));
  });

  app.post('/api/users/:username/unlock', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    return wrap(req, 'user.unlock', username, async () => unlockUser(username));
  });

  app.post('/api/users/:username/password', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    const schema = z.object({ password: z.string().min(8).max(200) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return wrap(req, 'user.passwd', username, async () => resetPassword(username, body.data.password));
  });

  app.post('/api/users/:username/groups', { preHandler: [loadSession, requireAuth('users.manage'), requireCsrf] }, async (req) => {
    const { username } = req.params as { username: string };
    const schema = z.object({ group: z.string(), op: z.enum(['add', 'remove']) });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    return wrap(req, `user.group.${body.data.op}`, `${username}:${body.data.group}`, async () => {
      if (body.data.op === 'add') await addUserToGroup(username, body.data.group);
      else await removeUserFromGroup(username, body.data.group);
    });
  });
}
