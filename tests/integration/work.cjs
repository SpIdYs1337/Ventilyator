/* Real PostgreSQL/Redis/API checks. Isolated fixtures are removed even on failure. */
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { createDatabase } = require('../../packages/database/dist');
const { permissionKeys } = require('../../packages/shared/dist');
const argon2 = require('../../apps/api/node_modules/argon2');
const Redis = require('../../apps/api/node_modules/ioredis');
if (process.env.NODE_ENV !== 'development') throw new Error('Work checks require development');
const db = createDatabase(process.env.DATABASE_URL);
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function request(path, { method = 'GET', data, cookie } = {}) {
  const r = await fetch(`http://127.0.0.1:3000/api${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: process.env.APP_ORIGIN, 'X-Ventilyator-Request': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function main() {
  const tag = randomUUID();
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const org = await db.organization.create({ data: { name: `Work ${tag}` } });
  const foreign = await db.organization.create({ data: { name: `Foreign work ${tag}` } });
  const orgIds = [org.id, foreign.id];
  const users = {};
  try {
    const role = await db.role.create({ data: { organizationId: org.id, name: 'Work Admin', permissions: { create: permissionKeys.map(permission => ({ grant: { connectOrCreate: { where: { key: permission }, create: { key: permission } } } })) } } });
    for (const name of ['admin', 'member', 'viewer', 'outsider', 'foreign']) {
      const user = await db.user.create({ data: { organizationId: name === 'foreign' ? foreign.id : org.id, name, email: `${name}-${tag}@example.org`, passwordHash, ...(name === 'admin' ? { roles: { create: { roleId: role.id } } } : {}) } });
      const login = await request('/auth/login', { method: 'POST', data: { email: user.email, password } });
      assert.equal(login.status, 201); users[name] = { ...user, cookie: login.cookie };
    }
    const admin = users.admin.cookie, member = users.member.cookie, viewer = users.viewer.cookie, outsider = users.outsider.cookie, other = users.foreign.cookie;
    await check('anonymous project access denied', async () => { assert.equal((await request('/projects')).status, 401); });
    await check('ordinary user cannot create projects', async () => { assert.equal((await request('/projects', { method: 'POST', cookie: member, data: { key: 'NO', name: 'Forbidden' } })).status, 403); });
    const created = await request('/projects', { method: 'POST', cookie: admin, data: { key: 'vnt', name: 'Рабочий проект', description: 'Integration project' } });
    assert.equal(created.status, 201); const id = created.body.id, base = `/projects/${id}`;
    await check('project stored with normalized key and owner membership', async () => {
      const p = await request(base, { cookie: admin }); assert.equal(p.status, 200); assert.equal(p.body.key, 'VNT'); assert.equal(p.body.myRole, 'MANAGER'); assert.equal(p.body.members[0].userId, users.admin.id);
      assert.equal((await db.project.findUnique({ where: { id } })).name, 'Рабочий проект');
    });
    await check('duplicate project key is a safe conflict', async () => { assert.equal((await request('/projects', { method: 'POST', cookie: admin, data: { key: 'VNT', name: 'Duplicate' } })).status, 409); });
    await check('uninvited and foreign users cannot discover a project', async () => {
      for (const cookie of [outsider, other]) { assert.equal((await request(base, { cookie })).status, 404); assert.equal((await request('/projects', { cookie })).body.total, 0); }
    });
    await check('foreign users cannot be invited', async () => { assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: admin, data: { userId: users.foreign.id, role: 'MEMBER' } })).status, 404); });
    for (const [name, role] of [['member', 'MEMBER'], ['viewer', 'VIEWER']]) assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: admin, data: { userId: users[name].id, role } })).status, 200);
    await check('invited members see the project', async () => { assert.equal((await request('/projects', { cookie: member })).body.total, 1); assert.equal((await request(base, { cookie: viewer })).body.myRole, 'VIEWER'); });
    await check('owner membership cannot be removed or demoted', async () => {
      assert.equal((await request(`${base}/members/${users.admin.id}`, { method: 'DELETE', cookie: admin })).status, 400);
      assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: admin, data: { userId: users.admin.id, role: 'VIEWER' } })).status, 400);
    });
    await check('member cannot change project settings or membership', async () => {
      assert.equal((await request(base, { method: 'PATCH', cookie: member, data: { name: 'Attack', version: 1 } })).status, 403);
      assert.equal((await request(`${base}/people`, { cookie: member })).status, 403);
      assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: member, data: { userId: users.outsider.id, role: 'MANAGER' } })).status, 403);
    });
    const input = { title: 'Проверить запуск', description: 'Реальная задача', assigneeId: users.member.id, dueAt: '2026-12-31T18:00:00Z', priority: 'HIGH', type: 'BUG' };
    const newTask = await request(`${base}/tasks`, { method: 'POST', cookie: member, data: input });
    assert.equal(newTask.status, 201); let task = newTask.body; const taskBase = `${base}/tasks/${task.id}`;
    await check('member creates a real assigned numbered task', async () => {
      assert.equal(task.number, 1); assert.equal(task.author.id, users.member.id); assert.equal(task.assignee.id, users.member.id); assert.equal(task.priority, 'HIGH');
      assert.equal((await db.task.findUnique({ where: { id: task.id } })).title, input.title);
    });
    await check('read-only viewer cannot write tasks or comments', async () => {
      assert.equal((await request(`${base}/tasks`, { method: 'POST', cookie: viewer, data: input })).status, 403);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: viewer, data: { title: 'Attack', version: task.version } })).status, 403);
      assert.equal((await request(`${taskBase}/comments`, { method: 'POST', cookie: viewer, data: { body: 'Attack' } })).status, 403);
      assert.equal((await request(taskBase, { cookie: viewer })).status, 200);
    });
    await check('task access does not bypass project ACL', async () => {
      for (const cookie of [outsider, other]) for (const suffix of ['', '/comments', '/events']) assert.equal((await request(taskBase + suffix, { cookie })).status, 404);
    });
    await check('assignment rejects outsiders, foreign users and viewers', async () => {
      for (const name of ['outsider', 'foreign', 'viewer']) assert.equal((await request(taskBase, { method: 'PATCH', cookie: member, data: { version: task.version, assigneeId: users[name].id } })).status, 400);
    });
    await check('strict validation rejects mass assignment and invalid values', async () => {
      for (const data of [{ authorId: users.admin.id, version: task.version }, { status: 'FAKE', version: task.version }, { title: '', version: task.version }, { dueAt: 'invalid', version: task.version }]) assert.equal((await request(taskBase, { method: 'PATCH', cookie: member, data })).status, 400);
      assert.equal((await request(`${base}/tasks?limit=1000`, { cookie: member })).status, 400);
    });
    await check('simultaneous task creates allocate unique sequential numbers', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, (_, n) => request(`${base}/tasks`, { method: 'POST', cookie: member, data: { title: `Concurrent ${n}` } })));
      assert.ok(results.every(r => r.status === 201)); assert.deepEqual(results.map(r => r.body.number).sort((a, b) => a - b), [2, 3, 4, 5, 6]);
    });
    await check('optimistic locking rejects stale saves', async () => {
      const changed = await request(taskBase, { method: 'PATCH', cookie: member, data: { title: 'Новое название', version: task.version } }); assert.equal(changed.status, 200);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: member, data: { description: 'Stale', version: task.version } })).status, 409); task = changed.body;
    });
    await check('simultaneous updates cannot overwrite each other', async () => {
      const results = await Promise.all(['First', 'Second'].map(title => request(taskBase, { method: 'PATCH', cookie: member, data: { title, version: task.version } })));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); task = results.find(r => r.status === 200).body;
    });
    await check('completion time is set, preserved on close and cleared on reopen', async () => {
      const done = await request(taskBase, { method: 'PATCH', cookie: member, data: { status: 'DONE', version: task.version } }); assert.equal(done.status, 200); assert.ok(done.body.completedAt);
      const closed = await request(taskBase, { method: 'PATCH', cookie: member, data: { status: 'CLOSED', version: done.body.version } }); assert.equal(closed.body.completedAt, done.body.completedAt);
      const reopen = await request(taskBase, { method: 'PATCH', cookie: member, data: { status: 'IN_PROGRESS', version: closed.body.version } }); assert.equal(reopen.body.completedAt, null); task = reopen.body;
    });
    await check('search, assignee filters and pagination operate on stored tasks', async () => {
      const mine = await request(`${base}/tasks?mine=true`, { cookie: member }); assert.equal(mine.body.total, 1); assert.equal(mine.body.items[0].id, task.id);
      assert.equal((await request(`${base}/tasks?status=IN_PROGRESS`, { cookie: member })).body.total, 1);
      assert.equal((await request(`${base}/tasks?q=Concurrent&limit=2&offset=2`, { cookie: member })).body.items.length, 2);
    });
    await check('comments persist as plain text with author and time', async () => {
      assert.equal((await request(`${taskBase}/comments`, { method: 'POST', cookie: member, data: { body: 'Комментарий <script>no execution</script>' } })).status, 201);
      const r = await request(`${taskBase}/comments`, { cookie: viewer }); assert.equal(r.body.total, 1); assert.equal(r.body.items[0].author.id, users.member.id);
      assert.equal(await db.taskComment.count({ where: { taskId: task.id } }), 1);
    });
    await check('task history records real before/after values', async () => {
      const r = await request(`${taskBase}/events`, { cookie: viewer }); assert.ok(r.body.items.some(e => e.action === 'task.created'));
      assert.ok(r.body.items.some(e => e.changes.title?.before === 'Проверить запуск' && e.changes.title?.after === 'Новое название'));
    });
    await check('composite foreign keys reject cross-organization task authors', async () => {
      await assert.rejects(db.task.create({ data: { projectId: id, organizationId: org.id, authorId: users.foreign.id, title: 'Foreign author', number: 999 } }), e => e.code === 'P2003');
    });
    let project = (await request(base, { cookie: admin })).body;
    await check('project archival makes tasks, comments and members read-only', async () => {
      const r = await request(base, { method: 'PATCH', cookie: admin, data: { archived: true, version: project.version } }); assert.equal(r.status, 200); project = r.body;
      assert.equal((await request(`${base}/tasks`, { method: 'POST', cookie: admin, data: { title: 'Archived' } })).status, 409);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: member, data: { version: task.version, title: 'Archived' } })).status, 409);
      assert.equal((await request(`${taskBase}/comments`, { method: 'POST', cookie: member, data: { body: 'Archived' } })).status, 409);
      assert.equal((await request(taskBase, { cookie: viewer })).status, 200);
      assert.equal((await request('/projects?archived=true', { cookie: member })).body.total, 1);
    });
    await check('project can be restored without losing tasks', async () => {
      assert.equal((await request(base, { method: 'PATCH', cookie: admin, data: { archived: false, version: project.version } })).status, 200);
      assert.equal((await request(`${base}/tasks`, { cookie: member })).body.total, 6);
    });
    await check('demoting an assignee to viewer clears assignments and write access', async () => {
      assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: admin, data: { userId: users.member.id, role: 'VIEWER' } })).status, 200);
      assert.equal((await request(taskBase, { cookie: member })).body.assignee, null);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: member, data: { title: 'Denied', version: task.version } })).status, 403);
      assert.equal((await request(`${base}/members`, { method: 'PUT', cookie: admin, data: { userId: users.member.id, role: 'MEMBER' } })).status, 200);
      const current = (await request(taskBase, { cookie: admin })).body;
      const r = await request(taskBase, { method: 'PATCH', cookie: admin, data: { assigneeId: users.member.id, version: current.version } });
      assert.equal(r.status, 200); task = r.body;
    });
    await check('removing membership revokes access and clears assignments with history', async () => {
      assert.equal((await request(`${base}/members/${users.member.id}`, { method: 'DELETE', cookie: admin })).status, 200);
      assert.equal((await request(taskBase, { cookie: member })).status, 404);
      const r = await request(taskBase, { cookie: admin }); assert.equal(r.body.assignee, null); assert.ok(r.body.version > task.version);
      const events = await request(`${taskBase}/events`, { cookie: admin }); assert.ok(events.body.items.some(e => e.changes.assigneeId?.after === null));
    });
    console.log(`Ventilyator projects/tasks integration: ${count} passed`);
  } finally {
    const sessions = await db.sessionMetadata.findMany({ where: { user: { organizationId: { in: orgIds } } } });
    const redis = new Redis(process.env.REDIS_URL); if (sessions.length) await redis.del(...sessions.map(s => `session:${s.id}`)); redis.disconnect();
    await db.task.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.role.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.$disconnect();
  }
}
main().catch(error => { console.error('Work integration failed:', error instanceof assert.AssertionError ? error.message : error.code ?? error.name); process.exitCode = 1; });
