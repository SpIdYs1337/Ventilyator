import { z } from 'zod';
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(256), remember: z.boolean().default(false), provider: z.enum(['local', 'imap']).default('local') }).strict();
export const createUserSchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(100), password: z.string().min(14).max(256), roleId: z.uuid() }).strict();
export const createRoleSchema = z.object({ name: z.string().trim().min(1).max(100), permissions: z.array(z.string()).max(30) }).strict();
export * from './work';
