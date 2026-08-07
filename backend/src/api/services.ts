import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  getService,
  getServiceLogs,
  getServiceStatusText,
  listServices,
  serviceAction,
} from '../services/systemd/service.js';
import { AppError } from '../utils/errors.js';

async function auditedAction(
  req: { auth?: { user: { id: number; username: string } }; ip: string },
  action: string,
  target: string,
  fn: () => Promise<void>,
) {
  try {
    await fn();
    writeAudit({
      userId: req.auth!.user.id,
      username: req.auth!.user.username,
      action,
      target,
      success: true,
      ip: req.ip,
    });
    return { success: true };
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

export async function registerServiceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/services', { preHandler: [loadSession, requireAuth('services.read')] }, async () => {
    return { success: true, data: await listServices() };
  });

  app.get('/api/services/:name', { preHandler: [loadSession, requireAuth('services.read')] }, async (req) => {
    const { name } = req.params as { name: string };
    return { success: true, data: await getService(name) };
  });

  for (const op of ['start', 'stop', 'restart', 'reload', 'enable', 'disable'] as const) {
    app.post(
      `/api/services/:name/${op}`,
      { preHandler: [loadSession, requireAuth('services.manage'), requireCsrf] },
      async (req) => {
        const { name } = req.params as { name: string };
        const confirm = z.object({ confirm: z.literal(true) }).safeParse(req.body);
        if ((op === 'stop' || op === 'restart' || op === 'disable') && !confirm.success) {
          throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
        }
        return auditedAction(req, `service.${op}`, name, () => serviceAction(name, op));
      },
    );
  }

  app.get(
    '/api/services/:name/status',
    { preHandler: [loadSession, requireAuth('services.read')] },
    async (req) => {
      const { name } = req.params as { name: string };
      return { success: true, data: { text: await getServiceStatusText(name) } };
    },
  );

  app.get(
    '/api/services/:name/logs',
    { preHandler: [loadSession, requireAuth('logs.read')] },
    async (req) => {
      const { name } = req.params as { name: string };
      const q = req.query as { lines?: string };
      const lines = q.lines ? Number(q.lines) : 100;
      return { success: true, data: { lines: await getServiceLogs(name, lines) } };
    },
  );
}
