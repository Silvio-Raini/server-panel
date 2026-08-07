import type { FastifyInstance } from 'fastify';
import { loadSession, requireAuth } from '../middleware/auth.js';
import { listStorage } from '../services/filesystem/storage.js';

export async function registerStorageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/storage', { preHandler: [loadSession, requireAuth('storage.read')] }, async () => {
    return { success: true, data: await listStorage() };
  });
}
