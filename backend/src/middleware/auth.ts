import type { FastifyReply, FastifyRequest } from 'fastify';
import { assertPermission, type Permission } from '../auth/permissions.js';
import { getSession, sessionCookieName, verifyCsrf } from '../auth/session.js';
import type { PanelUser } from '../database/db.js';
import { AppError } from '../utils/errors.js';

export interface AuthContext {
  user: PanelUser;
  sessionId: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export async function loadSession(req: FastifyRequest): Promise<void> {
  const sid = req.cookies[sessionCookieName()];
  if (!sid) return;
  const session = getSession(sid);
  if (!session) return;
  req.auth = {
    user: session.user,
    sessionId: session.id,
    csrfToken: session.csrf_token,
  };
}

export function requireAuth(permission?: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.auth) {
      throw new AppError('UNAUTHORIZED', 'Anmeldung erforderlich.', 401);
    }
    if (permission) {
      assertPermission(req.auth.user.role, permission);
    }
  };
}

export async function requireCsrf(req: FastifyRequest): Promise<void> {
  if (!req.auth) throw new AppError('UNAUTHORIZED', 'Anmeldung erforderlich.', 401);
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
  const token = (req.headers['x-csrf-token'] as string | undefined) || undefined;
  if (!verifyCsrf(req.auth.csrfToken, token)) {
    throw new AppError('CSRF_FAILED', 'CSRF-Token ungültig.', 403);
  }
}
