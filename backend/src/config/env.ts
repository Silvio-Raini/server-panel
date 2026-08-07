import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: path.join(rootDir, '.env') });
loadEnv({ path: '/etc/server-panel/.env' });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  DATABASE_PATH: z.string().default(path.join(rootDir, 'data', 'panel.db')),
  SESSION_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(16),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(28800),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  BOOTSTRAP_ADMIN_USER: z.string().min(3).default('admin'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default('ChangeMeNow!'),
  HELPER_PATH: z.string().default('/usr/local/sbin/server-panel-helper'),
  PUBLIC_URL: z.string().url().default('https://server.codigoworks.net'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  FRONTEND_DIST: z.string().default(path.join(rootDir, 'frontend', 'dist')),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
  throw new Error('Invalid environment');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
