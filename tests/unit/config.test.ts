import { describe, it, expect } from 'vitest';
import { readConfig } from '../../packages/config/src';
import { createUserSchema, loginSchema } from '../../packages/validation/src';

const base = { DATABASE_URL: 'postgresql://user:password@localhost/ventilyator', REDIS_URL: 'redis://localhost:6379', APP_ORIGIN: 'http://localhost:8080', STORAGE_ROOT: '/tmp/ventilyator-test' };
describe('Server configuration', () => {
  it('rejects production over HTTP', () => { expect(() => readConfig({ ...base, NODE_ENV: 'production' })).toThrow('HTTPS'); });
  it('requires PostgreSQL instead of accepting another URL protocol', () => { expect(() => readConfig({ ...base, DATABASE_URL: 'https://example.org' })).toThrow(); });
  it('requires an absolute storage path', () => { expect(() => readConfig({ ...base, STORAGE_ROOT: '../storage' })).toThrow(); });
  it('allows absent optional IMAP settings without affecting local auth', () => { expect(readConfig({ ...base, IMAP_ORGANIZATION_ID: '', IMAP_HOST: '' }).IMAP_ORGANIZATION_ID).toBeUndefined(); });
  it('bounds session absolute lifetime', () => { expect(() => readConfig({ ...base, SESSION_MAX_DAYS: '99999' })).toThrow(); });
});
describe('Authentication and provisioning input', () => {
  it('normalizes identity email', () => { expect(loginSchema.parse({ email: 'Alice@Example.org', password: 'value' }).email).toBe('alice@example.org'); });
  it('does not allow the caller to inject an organization', () => { expect(loginSchema.safeParse({ email: 'alice@example.org', password: 'value', organizationId: 'foreign' }).success).toBe(false); });
  it('does not allow short administrator-created passwords', () => { expect(createUserSchema.safeParse({ email: 'user@example.org', name: 'User', password: 'short', roleId: '00000000-0000-4000-8000-000000000000' }).success).toBe(false); });
  it('rejects arbitrary authentication providers', () => { expect(loginSchema.safeParse({ email: 'alice@example.org', password: 'value', provider: 'http://evil.example' }).success).toBe(false); });
});
