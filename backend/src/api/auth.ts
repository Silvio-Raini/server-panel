import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { permissionsFor } from '../auth/permissions.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  createSession,
  destroySession,
  sessionCookieName,
} from '../auth/session.js';
import { writeAudit } from '../audit/logger.js';
import { env } from '../config/env.js';
import { getDb, type PanelUser } from '../database/db.js';
import { loadSession, requireAuth, requireCsrf } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: env.LOGIN_RATE_LIMIT_MAX,
        timeWindow: env.LOGIN_RATE_LIMIT_WINDOW_MS,
      },
    },
  }, async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      throw new AppError('VALIDATION_ERROR', 'Ungültige Anmeldedaten.', 400);
    }

    const { username, password } = body.data;
    const ip = req.ip;
    const user = getDb()
      .prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`)
      .get(username) as PanelUser | undefined;

    const valid = user && !user.disabled ? await verifyPassword(user.password_hash, password) : false;

    getDb()
      .prepare(`INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)`)
      .run(username, ip, valid ? 1 : 0);

    if (!valid || !user) {
      writeAudit({
        username,
        action: 'auth.login',
        target: username,
        success: false,
        message: 'Ungültige Anmeldedaten',
        ip,
      });
      throw new AppError('INVALID_CREDENTIALS', 'Benutzername oder Passwort falsch.', 401);
    }

    // Placeholder for future TOTP: if user.totp_enabled, require second step.
    const session = createSession(user.id, ip, req.headers['user-agent'] || null);
    getDb()
      .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
      .run(user.id);

    reply.setCookie(sessionCookieName(), session.sessionId, {
      path: '/',
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: env.COOKIE_SAME_SITE,
      expires: session.expiresAt,
    });

    writeAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.login',
      target: user.username,
      success: true,
      ip,
    });

    return {
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          totpEnabled: Boolean(user.totp_enabled),
          permissions: permissionsFor(user.role),
        },
        csrfToken: session.csrfToken,
      },
    };
  });

  app.post('/api/auth/logout', { preHandler: [loadSession, requireAuth(), requireCsrf] }, async (req, reply) => {
    if (req.auth) {
      destroySession(req.auth.sessionId);
      writeAudit({
        userId: req.auth.user.id,
        username: req.auth.user.username,
        action: 'auth.logout',
        success: true,
        ip: req.ip,
      });
    }
    reply.clearCookie(sessionCookieName(), { path: '/' });
    return { success: true };
  });

  app.get('/api/auth/me', { preHandler: [loadSession, requireAuth()] }, async (req) => {
    const user = req.auth!.user;
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          totpEnabled: Boolean(user.totp_enabled),
          permissions: permissionsFor(user.role),
        },
        csrfToken: req.auth!.csrfToken,
      },
    };
  });

  app.post('/api/auth/change-password', {
    preHandler: [loadSession, requireAuth(), requireCsrf],
  }, async (req) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(200),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) throw new AppError('VALIDATION_ERROR', 'Ungültige Eingabe.', 400);

    const user = req.auth!.user;
    const ok = await verifyPassword(user.password_hash, body.data.currentPassword);
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Aktuelles Passwort ist falsch.', 401);

    const passwordHash = await hashPassword(body.data.newPassword);
    getDb().prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, user.id);
    writeAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.change_password',
      success: true,
      ip: req.ip,
    });
    return { success: true };
  });
}
