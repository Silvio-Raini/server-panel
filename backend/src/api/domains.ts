import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../audit/logger.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import {
  createDomain,
  deleteDomain,
  getDomain,
  listAllowedRoots,
  listDomains,
  requestCertificate,
  updateDomain,
} from '../services/domains/domains.js';
import { AppError } from '../utils/errors.js';

const domainBodySchema = z.object({
  domain: z.string().min(3).max(253),
  type: z.enum(['static', 'proxy', 'redirect']),
  target: z.string().min(1).max(500),
  aliases: z.array(z.string()).max(20).optional(),
  autoSsl: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

export async function registerDomainRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/domains', { preHandler: [loadSession, requireAuth('domains.read')] }, async () => {
    return {
      success: true,
      data: {
        domains: listDomains(),
        allowedRoots: listAllowedRoots(),
      },
    };
  });

  app.get('/api/domains/:id', { preHandler: [loadSession, requireAuth('domains.read')] }, async (req) => {
    const { id } = req.params as { id: string };
    return { success: true, data: getDomain(id) };
  });

  app.post('/api/domains', { preHandler: [loadSession, requireAuth('domains.manage'), requireCsrf] }, async (req) => {
    const body = domainBodySchema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    try {
      const data = await createDomain(body.data);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.create',
        target: body.data.domain,
        success: true,
        ip: req.ip,
      });
      return { success: true, data };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.create',
        target: body.data.domain,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.put('/api/domains/:id', { preHandler: [loadSession, requireAuth('domains.manage'), requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const schema = domainBodySchema.partial().omit({ domain: true });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);
    const current = getDomain(id);
    try {
      const data = await updateDomain(id, body.data);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.update',
        target: current.domain,
        success: true,
        ip: req.ip,
      });
      return { success: true, data };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.update',
        target: current.domain,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.delete('/api/domains/:id', { preHandler: [loadSession, requireAuth('domains.manage'), requireCsrf] }, async (req) => {
    const { id } = req.params as { id: string };
    const schema = z.object({
      confirm: z.literal(true),
      deleteCert: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('CONFIRMATION_REQUIRED', 'Bestätigung erforderlich.', 400);
    const current = getDomain(id);
    try {
      await deleteDomain(id, body.data.deleteCert === true);
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.delete',
        target: current.domain,
        success: true,
        ip: req.ip,
      });
      return { success: true };
    } catch (err) {
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.delete',
        target: current.domain,
        success: false,
        message: err instanceof Error ? err.message : 'error',
        ip: req.ip,
      });
      throw err;
    }
  });

  app.post(
    '/api/domains/:id/ssl',
    { preHandler: [loadSession, requireAuth('domains.manage'), requireCsrf] },
    async (req) => {
      const { id } = req.params as { id: string };
      const current = getDomain(id);
      try {
        const data = await requestCertificate(id);
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: 'domain.ssl',
          target: current.domain,
          success: true,
          ip: req.ip,
        });
        return { success: true, data };
      } catch (err) {
        writeAudit({
          userId: req.auth!.user.id,
          username: req.auth!.user.username,
          action: 'domain.ssl',
          target: current.domain,
          success: false,
          message: err instanceof Error ? err.message : 'error',
          ip: req.ip,
        });
        throw err;
      }
    },
  );

  app.post(
    '/api/domains/:id/reapply',
    { preHandler: [loadSession, requireAuth('domains.manage'), requireCsrf] },
    async (req) => {
      const { id } = req.params as { id: string };
      const current = getDomain(id);
      const data = await updateDomain(id, {});
      writeAudit({
        userId: req.auth!.user.id,
        username: req.auth!.user.username,
        action: 'domain.reapply',
        target: current.domain,
        success: true,
        ip: req.ip,
      });
      return { success: true, data };
    },
  );
}
