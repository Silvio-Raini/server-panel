import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import { listProcesses, signalProcess } from '../services/processes/processes.js';
import { AppError } from '../utils/errors.js';

export async function registerProcessRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/processes', { preHandler: [loadSession, requireAuth('processes.read')] }, async (req) => {
    const q = req.query as { sort?: string };
    const sort = (['cpu', 'mem', 'pid', 'user'].includes(q.sort || '') ? q.sort : 'cpu') as
      | 'cpu'
      | 'mem'
      | 'pid'
      | 'user';
    return { success: true, data: await listProcesses(sort) };
  });

  app.post(
    '/api/processes/:pid/terminate',
    { preHandler: [loadSession, requireAuth('processes.manage'), requireCsrf] },
    async (req) => {
      const pid = Number((req.params as { pid: string }).pid);
      const schema = z.object({
        confirm: z.literal(true),
        signal: z.enum(['TERM', 'KILL']).default('TERM'),
      });
      const body = schema.safeParse(req.body);
      if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
      try {
        await signalProcess(pid, body.data.signal);
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: `process.${body.data.signal.toLowerCase()}`,
          target: String(pid),
          success: true,
          ip: req.ip,
        });
        return { success: true };
      } catch (err) {
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: `process.${body.data.signal.toLowerCase()}`,
          target: String(pid),
          success: false,
          message: err instanceof Error ? err.message : 'error',
          ip: req.ip,
        });
        throw err;
      }
    },
  );
}
