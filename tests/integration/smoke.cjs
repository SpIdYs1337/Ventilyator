/* Run only inside the DEVELOPMENT API container against its development database.
   Fixtures have random credentials, are never printed, and are removed after the run. */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createDatabase } = require('../../packages/database/dist');
const argon2 = require('../../apps/api/node_modules/argon2');
const { Queue, QueueEvents } = require('../../apps/api/node_modules/bullmq');
if (process.env.NODE_ENV !== 'development') throw new Error('Smoke tests require NODE_ENV=development');
const db = createDatabase(process.env.DATABASE_URL);
const origin = process.env.APP_ORIGIN;
const base = 'http://127.0.0.1:3000/api';
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function request(path, { method = 'GET', data, cookie, csrf = true, from = origin } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Ventilyator-Request': '1' } : {}), Origin: from, ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0], cookieHeader: res.headers.get('set-cookie') };
}
async function main() {
  const tag = randomUUID();
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const org = await db.organization.create({ data: { name: `Smoke ${tag}` } });
  const foreign = await db.organization.create({ data: { name: `Foreign ${tag}` } });
  const createdIds = [];
  let queue, events;
  try {
    const role = await db.role.create({ data: { organizationId: org.id, name: 'Smoke Admin', permissions: { create: ['system:read', 'users:manage', 'roles:manage', 'sessions:revoke', 'audit:read'].map(permission => ({ grant: { connectOrCreate: { where: { key: permission }, create: { key: permission } } } })) } } });
    const viewer = await db.role.create({ data: { organizationId: org.id, name: 'Smoke Viewer' } });
    const foreignRole = await db.role.create({ data: { organizationId: foreign.id, name: 'Foreign Role' } });
    const admin = await db.user.create({ data: { name: 'Smoke', email: `smoke-${tag}@example.org`, organizationId: org.id, passwordHash, roles: { create: { roleId: role.id } } } });
    const outsider = await db.user.create({ data: { name: 'Foreign', email: `foreign-${tag}@example.org`, organizationId: foreign.id, passwordHash } });
    createdIds.push(admin.id, outsider.id);
    await check('public liveness and real readiness', async () => { assert.equal((await request('/health/live')).status, 200); assert.equal((await request('/health/ready')).status, 200); });
    await check('anonymous admin access denied', async () => { assert.equal((await request('/admin/users')).status, 401); });
    await check('CSRF origin and header checks', async () => {
      assert.equal((await request('/auth/login', { method: 'POST', data: {}, from: 'https://evil.example' })).status, 403);
      assert.equal((await request('/auth/login', { method: 'POST', data: {}, csrf: false })).status, 403);
    });
    await check('wrong password denied', async () => { assert.equal((await request('/auth/login', { method: 'POST', data: { email: admin.email, password: 'incorrect' } })).status, 401); });
    const login = await request('/auth/login', { method: 'POST', data: { email: admin.email, password, remember: true } });
    assert.equal(login.status, 201);
    const cookie = login.cookie;
    assert.ok(cookie);
    await check('local login uses opaque HttpOnly session cookie', async () => { assert.match(cookie, /^ventilyator_session=[A-Za-z0-9_-]{43}$/); assert.match(login.cookieHeader, /HttpOnly/i); assert.match(login.cookieHeader, /SameSite=Lax/i); assert.equal((await request('/auth/me', { cookie })).body.id, admin.id); });
    await check('organization-scoped users never contain password hashes', async () => {
      const r = await request('/admin/users', { cookie }); assert.equal(r.status, 200);
      assert.ok(r.body.some(u => u.id === admin.id)); assert.ok(!r.body.some(u => u.id === outsider.id)); assert.ok(!JSON.stringify(r.body).includes('passwordHash'));
    });
    const email = `created-${tag}@example.org`;
    await check('administrator creates a persistent local user', async () => {
      const r = await request('/admin/users', { cookie, method: 'POST', data: { name: 'Created', email, password, roleId: viewer.id } });
      assert.equal(r.status, 201); createdIds.push(r.body.id);
      const stored = await db.user.findUnique({ where: { email } }); assert.match(stored.passwordHash, /^\$argon2id\$/); assert.notEqual(stored.passwordHash, password);
    });
    await check('duplicate user creation returns a safe conflict', async () => { const r = await request('/admin/users', { cookie, method: 'POST', data: { name: 'Duplicate', email, password, roleId: viewer.id } }); assert.equal(r.status, 409); assert.ok(!JSON.stringify(r.body).includes('passwordHash')); });
    await check('cannot assign a foreign organization role', async () => { assert.equal((await request('/admin/users', { cookie, method: 'POST', data: { name: 'Attack', email: `attack-${tag}@example.org`, password, roleId: foreignRole.id } })).status, 404); });
    const member = await request('/auth/login', { method: 'POST', data: { email, password } });
    await check('new local user logs in and is denied administrative APIs', async () => { assert.equal(member.status, 201); assert.equal((await request('/admin/users', { cookie: member.cookie })).status, 403); });
    await check('IMAP cannot implicitly link a local account', async () => { assert.equal((await request('/auth/login', { method: 'POST', data: { email, password, provider: 'imap' } })).status, 401); });
    await check('session fixation is prevented', async () => { const second = await request('/auth/login', { method: 'POST', cookie, data: { email: admin.email, password } }); assert.notEqual(second.cookie, cookie); });
    await check('an administrator cannot revoke another organization session', async () => {
      const other = await request('/auth/login', { method: 'POST', data: { email: outsider.email, password } });
      const foreignSession = (await request('/auth/sessions', { cookie: other.cookie })).body[0];
      assert.equal((await request(`/admin/sessions/${foreignSession.id}`, { method: 'DELETE', cookie })).status, 404);
    });
    await check('worker actually processes BullMQ jobs using PostgreSQL', async () => {
      queue = new Queue('ventilyator-system', { connection: { url: process.env.REDIS_URL } });
      events = new QueueEvents('ventilyator-system', { connection: { url: process.env.REDIS_URL } });
      await events.waitUntilReady();
      const job = await queue.add('health-probe', {}, { jobId: `smoke-${tag}` });
      assert.deepEqual(await job.waitUntilFinished(events, 15000), { application: 'Ventilyator', processed: true });
      await job.remove();
    });
    await check('logout invalidates the session server-side', async () => { assert.equal((await request('/auth/logout', { method: 'POST', cookie })).status, 201); assert.equal((await request('/auth/me', { cookie })).status, 401); });
    await check('authentication and provisioning leave an audit trail', async () => { const actions = (await db.auditEvent.findMany({ where: { organizationId: org.id } })).map(x => x.action); assert.ok(actions.includes('auth.login')); assert.ok(actions.includes('auth.logout')); assert.ok(actions.includes('user.created')); });
    console.log(`Ventilyator integration: ${count} checks passed`);
  } finally {
    if (events) await events.close(); if (queue) await queue.close();
    const Redis = require('../../apps/api/node_modules/ioredis');
    const redis = new Redis(process.env.REDIS_URL);
    const sessions = await db.sessionMetadata.findMany({ where: { userId: { in: createdIds } } });
    if (sessions.length) await redis.del(...sessions.map(s => `session:${s.id}`));
    redis.disconnect();
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [org.id, foreign.id] } } });
    await db.user.deleteMany({ where: { organizationId: { in: [org.id, foreign.id] } } });
    await db.role.deleteMany({ where: { organizationId: { in: [org.id, foreign.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [org.id, foreign.id] } } });
    await db.$disconnect();
  }
}
main().catch(() => { console.error('Ventilyator integration check failed (no credential-bearing diagnostics logged)'); process.exitCode = 1; });
