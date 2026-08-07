import type { FastifyInstance } from 'fastify';
import { loadSession, requireAuth } from '../middleware/auth.js';
import { getSystemInfo } from '../services/system/info.js';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/system', { preHandler: [loadSession, requireAuth('system.read')] }, async () => {
    const data = await getSystemInfo();
    return { success: true, data };
  });
}
