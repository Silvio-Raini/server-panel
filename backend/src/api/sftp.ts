import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  createSftpAccount,
  deleteSftpAccount,
  getSftpAccount,
  listSftpAccounts,
  setSftpPassword,
  sftpConnectionInfo,
  updateSftpAccount,
} from '../services/sftp/sftp.js';
import { AppError } from '../utils/errors.js';

export async function registerSftpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sftp', { preHandler: [loadSession, requireAuth('sftp.read')] }, async () => {
    return {
      success: true,
      data: {
        accounts: listSftpAccounts(),
        connection: sftpConnectionInfo(),
      },
    };
  });

  app.get('/api/sftp/:id', { preHandler: [loadSession, requireAuth('sftp.read')] }, async (req) => {
    const { id } = req.params as { id: string };
    return { success: true, data: getSftpAccount(id) };
  });

  app.post('/api/sftp', { preHandler: [loadSession, requireAuth('sftp.manage'), requireCsrf] }, async (req) => {
    const schema = z.object({
      username: z.string().min(6).max(32),
      password: z.string().min(10).max(200),
      permission: z.enum(['rw', 'ro']).optional(),
      notes: z.string().max(500).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    try {
      const data = await createSftpAccount(body.data);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.create',
        target: body.data.username,
        success: true,
        ip: req.ip,
      });
      return { success: true, data };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.create',
        target: body.data.username,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.put('/api/sftp/:id', { preHandler: [loadSession, requireAuth('sftp.manage'), requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      permission: z.enum(['rw', 'ro']).optional(),
      notes: z.string().max(500).nullable().optional(),
      enabled: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    const current = getSftpAccount(id);
    try {
      const data = await updateSftpAccount(id, body.data);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.update',
        target: current.username,
        success: true,
        ip: req.ip,
      });
      return { success: true, data };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.update',
        target: current.username,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.post(
    '/api/sftp/:id/password',
    { preHandler: [loadSession, requireAuth('sftp.manage'), requireCsrf] },
    async (req) => {
      const { id } = req.params as { id: string };
      const schema = z.object({ password: z.string().min(10).max(200) });
      const body = schema.safeParse(req.body);
      if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
      const current = getSftpAccount(id);
      try {
        await setSftpPassword(id, body.data.password);
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: 'sftp.password',
          target: current.username,
          success: true,
          ip: req.ip,
        });
        return { success: true };
      } catch (err) {
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: 'sftp.password',
          target: current.username,
          success: false,
          message: err instanceof Error ? err.message : 'error',
          ip: req.ip,
        });
        throw err;
      }
    },
  );

  app.delete('/api/sftp/:id', { preHandler: [loadSession, requireAuth('sftp.manage'), requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      confirm: z.literal(true),
      removeData: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
    const current = getSftpAccount(id);
    try {
      await deleteSftpAccount(id, body.data.removeData === true);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.delete',
        target: current.username,
        success: true,
        ip: req.ip,
      });
      return { success: true };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'sftp.delete',
        target: current.username,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });
}
