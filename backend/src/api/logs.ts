import type { FastifyInstance } from 'fastify';
import { loadSession, requireAuth } from '../middleware/auth.js';
import { getJournalLogs } from '../services/logs/journal.js';

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/logs', { preHandler: [loadSession, requireAuth('logs.read')] }, async (req) => {
    const q = req.query as { unit?: string; since?: string; lines?: string };
    const data = await getJournalLogs({
      unit: q.unit,
      since: q.since,
      lines: q.lines ? Number(q.lines) : 100,
    });
    return { success: true, data };
  });

  app.get('/api/logs/services/:name', { preHandler: [loadSession, requireAuth('logs.read')] }, async (req) => {
    const { name } = req.params as { name: string };
    const q = req.query as { since?: string; lines?: string };
    const data = await getJournalLogs({
      unit: name,
      since: q.since,
      lines: q.lines ? Number(q.lines) : 100,
    });
    return { success: true, data };
  });
}
