import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z.url().startsWith('redis://'),
  APP_ORIGIN: z.url().transform(s => new URL(s).origin),
  STORAGE_ROOT: z.string().startsWith('/'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  SESSION_MAX_DAYS: z.coerce.number().int().min(7).max(90).default(30),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).default(993),
  IMAP_DOMAIN: z.string().optional(),
  IMAP_ORGANIZATION_ID: z.uuid().optional(),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')));
  if (c.NODE_ENV === 'production' && !c.APP_ORIGIN.startsWith('https://')) throw new Error('Production requires HTTPS APP_ORIGIN');
  return c;
}
export { encryptSecret, decryptSecret, mailCa } from './secrets';
