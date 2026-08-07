import type { FastifyInstance } from 'fastify';
import { listAudit } from '../audit/logger.js';
import { loadSession, requireAuth } from '../middleware/auth.js';

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/audit-log', { preHandler: [loadSession, requireAuth('audit.read')] }, async (req) => {
    const q = req.query as { limit?: string; offset?: string };
    const data = listAudit(q.limit ? Number(q.limit) : 100, q.offset ? Number(q.offset) : 0);
    return { success: true, data };
  });
}
