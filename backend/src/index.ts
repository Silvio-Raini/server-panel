import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { env, isProd } from './config/env.js';
import { initDatabase } from './database/db.js';
import { cleanupExpiredSessions } from './auth/session.js';
import { toPublicError, AppError } from './utils/errors.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerSystemRoutes } from './api/system.js';
import { registerServiceRoutes } from './api/services.js';
import { registerUserRoutes } from './api/users.js';
import { registerGroupRoutes } from './api/groups.js';
import { registerProcessRoutes } from './api/processes.js';
import { registerLogRoutes } from './api/logs.js';
import { registerStorageRoutes } from './api/storage.js';
import { registerNetworkRoutes } from './api/network.js';
import { registerAuditRoutes } from './api/audit.js';

async function main(): Promise<void> {
  await initDatabase();

  const app = Fastify({
    logger: {
      level: isProd ? 'info' : 'debug',
    },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });

  await app.register(sensible);
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(formbody);
  await app.register(cors, {
    origin: false, // same-origin behind reverse proxy
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  app.setErrorHandler((err, req, reply) => {
    const publicErr = toPublicError(err);
    if (!(err instanceof AppError)) {
      req.log.error({ err }, 'Unhandled error');
    } else if (err.statusCode >= 500) {
      req.log.error({ err, details: err.details }, err.message);
    }
    reply.status(publicErr.statusCode).send(publicErr.body);
  });

  app.get('/api/health', async () => ({ success: true, data: { status: 'ok' } }));

  await registerAuthRoutes(app);
  await registerSystemRoutes(app);
  await registerServiceRoutes(app);
  await registerUserRoutes(app);
  await registerGroupRoutes(app);
  await registerProcessRoutes(app);
  await registerLogRoutes(app);
  await registerStorageRoutes(app);
  await registerNetworkRoutes(app);
  await registerAuditRoutes(app);

  if (fs.existsSync(env.FRONTEND_DIST)) {
    await app.register(fastifyStatic, {
      root: env.FRONTEND_DIST,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Endpoint nicht gefunden.' },
        });
        return;
      }
      return reply.sendFile('index.html');
    });
  }

  setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch (err) {
      app.log.error({ err }, 'Session cleanup failed');
    }
  }, 60_000).unref();

  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`Server Panel listening on http://${env.HOST}:${env.PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
