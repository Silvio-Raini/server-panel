import type { FastifyInstance } from 'fastify';
import { loadSession, requireAuth } from '../middleware/auth.js';
import { getNetworkOverview } from '../services/network/network.js';

export async function registerNetworkRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/network', { preHandler: [loadSession, requireAuth('network.read')] }, async () => {
    return { success: true, data: await getNetworkOverview() };
  });
}
