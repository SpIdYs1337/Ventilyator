const assert = require('node:assert/strict');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { createDatabase } = require('../../packages/database/dist');
const { permissionKeys, defaultWorkflow } = require('../../packages/shared/dist');
const argon2 = require('../../apps/api/node_modules/argon2');
const Redis = require('../../apps/api/node_modules/ioredis');
const { mailFixture } = require('./mail-fixture.cjs');
if (process.env.NODE_ENV !== 'development') throw new Error('Development database only');
const db = createDatabase(process.env.DATABASE_URL);
let count = 0;
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function request(path, { method = 'GET', data, cookie, binary } = {}) {
  const r = await fetch(`http://127.0.0.1:3000/api${path}`, { method, headers: { Origin: process.env.APP_ORIGIN, 'X-Ventilyator-Request': '1', 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: binary ?? (data === undefined ? undefined : JSON.stringify(data)), signal: AbortSignal.timeout(20000) });
  const body = r.headers.get('content-type')?.includes('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer());
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0], headers: r.headers };
}
const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
async function main() {
  const tag = randomUUID(); const password = randomBytes(24).toString('base64url');
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const org = await db.organization.create({ data: { name: `Platform ${tag}` } });
  const foreign = await db.organization.create({ data: { name: `Other platform ${tag}` } });
  const orgIds = [org.id, foreign.id]; const people = {}; let mail;
  try {
    const roles = {};
    for (const [name, organizationId, permissions] of [['admin', org.id, permissionKeys], ['editor', org.id, ['projects:create', 'knowledge:create']], ['viewer', org.id, []], ['foreign', foreign.id, permissionKeys]]) {
      roles[name] = await db.role.create({ data: { name: `Platform ${name}`, organizationId, permissions: { create: permissions.map(permission => ({ grant: { connectOrCreate: { where: { key: permission }, create: { key: permission } } } })) } } });
      const user = await db.user.create({ data: { organizationId, name, email: `${name}-${tag}@example.org`, passwordHash: hash, roles: { create: { roleId: roles[name].id } } } });
      const login = await request('/auth/login', { method: 'POST', data: { email: user.email, password } }); assert.equal(login.status, 201);
      people[name] = { ...user, cookie: login.cookie };
    }
    const admin = people.admin.cookie, editor = people.editor.cookie, viewer = people.viewer.cookie, outsider = people.foreign.cookie;
    const projectResult = await request('/projects', { method: 'POST', cookie: admin, data: { key: 'PLAT', name: `Platform ${tag}` } }); assert.equal(projectResult.status, 201);
    const projectId = projectResult.body.id, project = `/projects/${projectId}`;
    for (const [name, role] of [['editor', 'MEMBER'], ['viewer', 'VIEWER']]) assert.equal((await request(`${project}/members`, { method: 'PUT', cookie: admin, data: { userId: people[name].id, role } })).status, 200);
    await check('anonymous knowledge access and viewer creation denied', async () => { assert.equal((await request('/knowledge/spaces')).status, 401); assert.equal((await request('/knowledge/spaces', { method: 'POST', cookie: viewer, data: { key: 'NO', name: 'No' } })).status, 403); });
    const created = await request('/knowledge/spaces', { method: 'POST', cookie: admin, data: { key: 'docs', name: `Документы ${tag}` } }); assert.equal(created.status, 201);
    const spaceId = created.body.id, space = `/knowledge/spaces/${spaceId}`;
    await check('space normalized, persisted and isolated from foreign administrator', async () => { assert.equal(created.body.key, 'DOCS'); assert.ok(await db.knowledgeSpace.findUnique({ where: { id: spaceId } })); assert.equal((await request(space, { cookie: outsider })).status, 404); });
    for (const [name, role] of [['editor', 'MEMBER'], ['viewer', 'VIEWER']]) assert.equal((await request(`${space}/members`, { method: 'PUT', cookie: admin, data: { userId: people[name].id, role } })).status, 200);
    await check('space member administration enforces organization and owner', async () => {
      assert.equal((await request(`${space}/members`, { method: 'PUT', cookie: admin, data: { userId: people.foreign.id, role: 'MEMBER' } })).status, 404);
      assert.equal((await request(`${space}/members/${people.admin.id}`, { method: 'DELETE', cookie: admin })).status, 400);
      assert.equal((await request(`${space}/members`, { method: 'PUT', cookie: editor, data: { userId: people.viewer.id, role: 'MANAGER' } })).status, 403);
    });
    const draft = await request(`${space}/pages`, { method: 'POST', cookie: editor, data: { title: `Страница ${tag}` } }); assert.equal(draft.status, 201);
    const pageId = draft.body.id, page = `${space}/pages/${pageId}`;
    await check('unpublished page is private to author and space administrators', async () => { assert.equal((await request(page, { cookie: viewer })).status, 404); assert.equal((await request(page, { cookie: admin })).status, 200); assert.ok(!(await request(`${space}/pages`, { cookie: viewer })).body.some(p => p.id === pageId)); });
    const firstContent = doc('Настройка корпоративных серверов и документация команды');
    await check('personal draft is saved but never returned to another editor', async () => {
      assert.equal((await request(`${page}/draft`, { method: 'PUT', cookie: editor, data: { title: `Страница ${tag}`, content: firstContent, baseRevision: 0 } })).status, 200);
      assert.ok((await request(page, { cookie: editor })).body.draft); assert.equal((await request(page, { cookie: admin })).body.draft, null);
      assert.equal((await request(`${page}/draft`, { method: 'PUT', cookie: viewer, data: { title: 'Attack', content: firstContent, baseRevision: 0 } })).status, 403);
    });
    let published = await request(`${page}/publish`, { method: 'POST', cookie: editor, data: { title: `Страница ${tag}`, content: firstContent, baseRevision: 0 } }); assert.equal(published.status, 201);
    await check('publish creates immutable revision and clears only own draft', async () => { assert.equal(published.body.revision, 1); assert.equal((await request(page, { cookie: viewer })).status, 200); assert.equal((await request(page, { cookie: editor })).body.draft, null); assert.equal(await db.pageRevision.count({ where: { pageId } }), 1); });
    await check('rich document validator blocks executable and external embedded content', async () => {
      for (const content of [{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'X', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }, { type: 'doc', content: [{ type: 'image', attrs: { src: 'https://tracking.invalid/a.png' } }] }]) assert.equal((await request(`${page}/publish`, { method: 'POST', cookie: editor, data: { title: 'Attack', content, baseRevision: 1 } })).status, 400);
    });
    await check('concurrent page publishing rejects stale version without losing draft', async () => {
      await request(`${page}/draft`, { method: 'PUT', cookie: editor, data: { title: 'Мой черновик', content: doc('Изменения редактора'), baseRevision: 1 } });
      const updated = await request(`${page}/publish`, { method: 'POST', cookie: admin, data: { title: `Страница ${tag}`, content: doc('Новая опубликованная версия'), baseRevision: 1 } }); assert.equal(updated.status, 201);
      assert.equal((await request(`${page}/publish`, { method: 'POST', cookie: editor, data: { title: 'Stale', content: doc('Stale'), baseRevision: 1 } })).status, 409);
      assert.equal((await request(page, { cookie: editor })).body.draft.title, 'Мой черновик'); published = updated;
    });
    await check('restoration creates a new revision and retains old versions', async () => {
      const restored = await request(`${page}/restore/1`, { method: 'POST', cookie: editor, data: { revision: published.body.revision } }); assert.equal(restored.status, 201); assert.equal(restored.body.revision, 3);
      assert.deepEqual(restored.body.content, firstContent); assert.equal((await request(`${page}/versions`, { cookie: viewer })).body.length, 3); published = restored;
    });
    const child = await request(`${space}/pages`, { method: 'POST', cookie: editor, data: { title: 'Дочерняя', parentId: pageId } }); assert.equal(child.status, 201);
    await check('page tree prevents cycles and archiving a parent with active children', async () => { assert.equal((await request(page, { method: 'PATCH', cookie: editor, data: { revision: 3, parentId: child.body.id } })).status, 400); assert.equal((await request(page, { method: 'PATCH', cookie: editor, data: { revision: 3, archived: true } })).status, 409); });
    await check('published page comments enforce edit access and create notifications', async () => { assert.equal((await request(`${page}/comments`, { method: 'POST', cookie: editor, data: { body: 'Обсуждение документа' } })).status, 201); assert.equal((await request(`${page}/comments`, { method: 'POST', cookie: viewer, data: { body: 'Denied' } })).status, 403); assert.equal((await request(`${page}/comments`, { cookie: viewer })).body.length, 1); assert.ok((await request('/notifications', { cookie: viewer })).body.total > 0); });
    await check('archive and restoration preserve page contents', async () => {
      assert.equal((await request(`${space}/pages/${child.body.id}`, { method: 'PATCH', cookie: editor, data: { revision: 0, archived: true } })).status, 200);
      const archived = await request(page, { method: 'PATCH', cookie: editor, data: { revision: 3, archived: true } }); assert.equal(archived.status, 200);
      assert.equal((await request(`${page}/publish`, { method: 'POST', cookie: editor, data: { title: 'Denied', content: firstContent, baseRevision: archived.body.revision } })).status, 409);
      const restored = await request(page, { method: 'PATCH', cookie: editor, data: { revision: archived.body.revision, archived: false } }); assert.equal(restored.status, 200); published = restored;
    });
    const t1 = await request(`${project}/tasks`, { method: 'POST', cookie: admin, data: { title: 'Основная задача', assigneeId: people.editor.id, estimateMinutes: 90, storyPoints: 5, labels: ['platform'] } }); assert.equal(t1.status, 201); let task = t1.body; const taskBase = `${project}/tasks/${task.id}`;
    const t2 = await request(`${project}/tasks`, { method: 'POST', cookie: editor, data: { title: 'Блокирующая', parentId: task.id, type: 'SUBTASK' } }); assert.equal(t2.status, 201);
    await check('task hierarchy prevents parent cycles', async () => { assert.equal((await request(taskBase, { method: 'PATCH', cookie: editor, data: { version: task.version, parentId: t2.body.id } })).status, 400); assert.equal((await request(`${taskBase}/details`, { cookie: editor })).body.children.length, 1); });
    await check('checklists persist and viewer cannot modify them', async () => {
      const item = await request(`${taskBase}/checklist`, { method: 'POST', cookie: editor, data: { label: 'Проверить данные' } }); assert.equal(item.status, 201);
      assert.equal((await request(`${taskBase}/checklist/${item.body.id}`, { method: 'PUT', cookie: viewer, data: { done: true } })).status, 403);
      assert.equal((await request(`${taskBase}/checklist/${item.body.id}`, { method: 'PUT', cookie: editor, data: { done: true } })).status, 200);
      assert.ok((await request(`${taskBase}/details`, { cookie: editor })).body.checklist[0].done);
    });
    await check('dependencies prevent graph cycles and premature completion', async () => {
      assert.equal((await request(`${taskBase}/dependencies`, { method: 'POST', cookie: editor, data: { dependsOnId: t2.body.id } })).status, 201);
      assert.equal((await request(`${project}/tasks/${t2.body.id}/dependencies`, { method: 'POST', cookie: editor, data: { dependsOnId: task.id } })).status, 400);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: editor, data: { status: 'DONE', version: task.version } })).status, 409);
    });
    await check('manual time and persistent timer are bounded and access controlled', async () => {
      assert.equal((await request(`${taskBase}/time`, { method: 'POST', cookie: viewer, data: { minutes: 30, startedAt: new Date().toISOString() } })).status, 403);
      assert.equal((await request(`${taskBase}/time`, { method: 'POST', cookie: editor, data: { minutes: 30, note: 'Проверка', startedAt: new Date().toISOString() } })).status, 201);
      assert.equal((await request(`${taskBase}/timer/start`, { method: 'POST', cookie: editor })).status, 201);
      assert.equal((await request(`${project}/tasks/${t2.body.id}/timer/start`, { method: 'POST', cookie: editor })).status, 409);
      assert.equal((await request(`${taskBase}/timer/stop`, { method: 'POST', cookie: editor })).status, 201);
      const details = await request(`${taskBase}/details`, { cookie: editor }); assert.equal(details.body.timeEntries.length, 2); assert.ok(details.body.timeEntries.reduce((n, e) => n + e.minutes, 0) >= 31);
    });
    await check('page/task links respect both context ACLs', async () => { assert.equal((await request(`${taskBase}/pages`, { method: 'POST', cookie: editor, data: { pageId } })).status, 201); assert.equal((await request(`${taskBase}/details`, { cookie: viewer })).body.links[0].page.id, pageId); assert.equal((await request(`${taskBase}/details`, { cookie: outsider })).status, 404); });
    let sprint1, sprint2;
    await check('sprints enforce a single active sprint', async () => {
      const input = { name: 'Спринт', startsAt: '2026-10-26T00:00:00Z', endsAt: '2026-11-09T00:00:00Z' };
      assert.equal((await request(`${project}/sprints`, { method: 'POST', cookie: editor, data: input })).status, 403);
      sprint1 = (await request(`${project}/sprints`, { method: 'POST', cookie: admin, data: input })).body;
      sprint2 = (await request(`${project}/sprints`, { method: 'POST', cookie: admin, data: { ...input, name: 'Второй' } })).body;
      assert.equal((await request(`${project}/sprints/${sprint1.id}`, { method: 'PUT', cookie: admin, data: { status: 'ACTIVE' } })).status, 200);
      assert.equal((await request(`${project}/sprints/${sprint2.id}`, { method: 'PUT', cookie: admin, data: { status: 'ACTIVE' } })).status, 409);
    });
    await check('closing sprint snapshots results and returns unfinished tasks to backlog', async () => {
      const updated = await request(taskBase, { method: 'PATCH', cookie: editor, data: { sprintId: sprint1.id, version: task.version } }); assert.equal(updated.status, 200); task = updated.body;
      const closed = await request(`${project}/sprints/${sprint1.id}`, { method: 'PUT', cookie: admin, data: { status: 'CLOSED' } }); assert.equal(closed.status, 200); assert.equal(closed.body.result.total, 1); assert.equal(closed.body.result.completed, 0);
      task = (await request(taskBase, { cookie: editor })).body; assert.equal(task.sprintId, null); assert.equal((await request(taskBase, { method: 'PATCH', cookie: editor, data: { sprintId: sprint1.id, version: task.version } })).status, 400);
    });
    await check('custom workflow status and manager-only transitions work', async () => {
      const p = (await request(project, { cookie: admin })).body;
      const workflow = { statuses: [...defaultWorkflow.statuses, { key: 'WAITING', name: 'Ожидает решения', done: false }], transitions: [{ from: 'NEW', to: 'WAITING', managerOnly: true }, { from: 'WAITING', to: 'IN_PROGRESS', managerOnly: false }] };
      const result = await fetch(`http://127.0.0.1:3000/api${project}/workflow`, { method: 'PUT', headers: { Cookie: admin, Origin: process.env.APP_ORIGIN, 'X-Ventilyator-Request': '1', 'Content-Type': 'application/json', 'If-Match': String(p.version) }, body: JSON.stringify(workflow) }); assert.equal(result.status, 200);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: editor, data: { version: task.version, status: 'WAITING' } })).status, 403);
      const moved = await request(taskBase, { method: 'PATCH', cookie: admin, data: { version: task.version, status: 'WAITING' } }); assert.equal(moved.status, 200);
      const next = await request(taskBase, { method: 'PATCH', cookie: editor, data: { version: moved.body.version, status: 'IN_PROGRESS' } }); assert.equal(next.status, 200); task = next.body;
    });
    await check('WIP limits are enforced against stored tasks rather than the visible page', async () => {
      const p = (await request(project, { cookie: admin })).body;
      const workflow = { ...p.workflow, transitions: [], statuses: p.workflow.statuses.map(s => s.key === 'WAITING' ? { ...s, wipLimit: 1 } : s) };
      const update = await fetch(`http://127.0.0.1:3000/api${project}/workflow`, { method: 'PUT', headers: { Cookie: admin, Origin: process.env.APP_ORIGIN, 'X-Ventilyator-Request': '1', 'Content-Type': 'application/json', 'If-Match': String(p.version) }, body: JSON.stringify(workflow) }); assert.equal(update.status, 200);
      const other = (await request(`${project}/tasks/${t2.body.id}`, { cookie: editor })).body;
      assert.equal((await request(`${project}/tasks/${other.id}`, { method: 'PATCH', cookie: editor, data: { status: 'WAITING', version: other.version } })).status, 200);
      assert.equal((await request(taskBase, { method: 'PATCH', cookie: editor, data: { status: 'WAITING', version: task.version } })).status, 409);
    });
    await check('task creation from a page is atomic and checks project write access', async () => {
      const before = await db.task.count({ where: { projectId } });
      assert.equal((await request(`${page}/tasks`, { method: 'POST', cookie: viewer, data: { projectId, title: 'Denied' } })).status, 403);
      assert.equal(await db.task.count({ where: { projectId } }), before);
      const result = await request(`${page}/tasks`, { method: 'POST', cookie: editor, data: { projectId, title: 'Задача из документа' } }); assert.equal(result.status, 201); assert.equal(result.body.description, '');
      assert.ok((await request(`${page}/tasks`, { cookie: viewer })).body.some(link => link.task.id === result.body.id));
    });
    const bytes = Buffer.from(`File fixture ${tag}`); let objectId;
    await check('file ticket validates path, size and write permissions', async () => {
      assert.equal((await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: viewer, data: { name: 'file.txt', size: bytes.length } })).status, 403);
      assert.equal((await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: '../file.txt', size: bytes.length } })).status, 400);
      assert.equal((await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: 'file.txt', size: 26214401 } })).status, 400);
    });
    await check('streaming upload stores bytes and SHA-256; direct foreign access is denied', async () => {
      const ticket = await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: 'файл.txt', size: bytes.length } }); assert.equal(ticket.status, 201); objectId = ticket.body.objectId;
      assert.equal((await request(`/files/uploads/${ticket.body.id}`, { method: 'PUT', cookie: editor, binary: bytes })).status, 200);
      const download = await request(`/files/${objectId}/download`, { cookie: viewer }); assert.equal(download.status, 200); assert.ok(download.body.equals(bytes)); assert.equal(download.headers.get('x-content-sha256'), createHash('sha256').update(bytes).digest('hex')); assert.match(download.headers.get('content-disposition'), /^attachment/);
      assert.equal((await request(`/files/${objectId}/download`, { cookie: outsider })).status, 404);
    });
    await check('new file version preserves old bytes and trash can be restored', async () => {
      const next = Buffer.from('Second version'); const ticket = await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: 'файл.txt', size: next.length, objectId } });
      assert.equal((await request(`/files/uploads/${ticket.body.id}`, { method: 'PUT', cookie: editor, binary: next })).status, 200);
      assert.ok((await request(`/files/${objectId}/download?version=1`, { cookie: viewer })).body.equals(bytes)); assert.ok((await request(`/files/${objectId}/download`, { cookie: viewer })).body.equals(next));
      assert.equal((await request(`/files/${objectId}`, { method: 'PATCH', cookie: editor, data: { deleted: true } })).status, 200); assert.equal((await request(`/files/${objectId}/download`, { cookie: viewer })).status, 404);
      assert.equal((await request(`/files/${objectId}`, { method: 'PATCH', cookie: editor, data: { deleted: false } })).status, 200);
    });
    await check('storage quota blocks reservations over limit', async () => { await db.storageQuota.create({ data: { organizationId: org.id, bytes: 1 } }); assert.equal((await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: 'quota.txt', size: 2 } })).status, 409); await db.storageQuota.delete({ where: { organizationId: org.id } }); });
    await check('expired uploads are reconciled without deleting a published version', async () => {
      const ticket = await request(`/files/task/${task.id}/uploads`, { method: 'POST', cookie: editor, data: { name: 'expired.txt', size: 3 } }); assert.equal(ticket.status, 201);
      await db.storageUpload.update({ where: { id: ticket.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await request('/files/reconcile', { method: 'POST', cookie: editor })).status, 403);
      const reconciled = await request('/files/reconcile', { method: 'POST', cookie: admin }); assert.equal(reconciled.status, 201); assert.ok(reconciled.body.cleaned >= 1);
      assert.equal((await db.storageUpload.findUnique({ where: { id: ticket.body.id } })).status, 'CLEANED');
      assert.equal((await request(`/files/${objectId}/download`, { cookie: viewer })).status, 200);
    });
    await check('search uses Russian full text and never reveals foreign or private drafts', async () => {
      const hidden = await request(`${space}/pages`, { method: 'POST', cookie: admin, data: { title: `PRIVATE-${tag}` } }); assert.equal(hidden.status, 201);
      const hits = await request('/search?q=' + encodeURIComponent('сервер'), { cookie: viewer }); assert.equal(hits.status, 200); assert.ok(hits.body.some(h => h.id === pageId));
      assert.equal((await request('/search?q=' + encodeURIComponent(`PRIVATE-${tag}`), { cookie: viewer })).body.length, 0);
      assert.equal((await request('/search?q=' + encodeURIComponent(tag), { cookie: outsider })).body.length, 0);
    });
    await check('dashboard, reports and widget preferences use real stored data', async () => {
      const d = await request('/dashboard', { cookie: editor }); assert.equal(d.status, 200); assert.ok(d.body.tasks.some(t => t.id === task.id));
      assert.equal((await request('/preferences', { method: 'PUT', cookie: editor, data: { widgets: ['knowledge', 'tasks'], emailEnabled: false } })).status, 200);
      assert.deepEqual((await request('/dashboard', { cookie: editor })).body.preferences.widgets, ['knowledge', 'tasks']);
      const report = await request(`${project}/reports`, { cookie: viewer }); assert.equal(report.status, 200); assert.ok(report.body.tasks.find(t => t.id === task.id).spentMinutes >= 31);
    });
    await check('deadline scheduler creates one persistent notice per due date and phase', async () => {
      const due = await request(`${project}/tasks`, { method: 'POST', cookie: admin, data: { title: 'Просроченная проверка', assigneeId: people.editor.id, dueAt: new Date(Date.now() - 60000).toISOString() } }); assert.equal(due.status, 201);
      const { startDeadlines } = require('../../apps/worker/dist/deadlines');
      const one = await startDeadlines(db); one.close(); const two = await startDeadlines(db); two.close();
      assert.equal(await db.notification.count({ where: { userId: people.editor.id, taskId: due.body.id, eventKey: { startsWith: 'deadline-overdue:' } } }), 1);
    });
    await check('required antivirus accepts only a clean scanner result and fails closed', async () => {
      const net = require('node:net'), fs = require('node:fs/promises'), path = require('node:path');
      const { scanFile } = require('../../apps/api/dist/files/antivirus');
      const root = await fs.mkdtemp('/tmp/ventilyator-av-'), file = path.join(root, 'fixture.bin'); await fs.writeFile(file, 'antivirus fixture');
      const previous = { ANTIVIRUS_REQUIRED: process.env.ANTIVIRUS_REQUIRED, CLAMAV_HOST: process.env.CLAMAV_HOST, CLAMAV_PORT: process.env.CLAMAV_PORT }; let reply = 'stream: Fixture FOUND\0';
      const server = net.createServer(socket => { let data = Buffer.alloc(0); socket.on('data', chunk => { data = Buffer.concat([data, chunk]); let offset = 10; while (offset + 4 <= data.length) { const size = data.readUInt32BE(offset); offset += 4; if (size === 0) { socket.end(reply); return; } if (offset + size > data.length) return; offset += size; } }); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      process.env.ANTIVIRUS_REQUIRED = 'true'; process.env.CLAMAV_HOST = '127.0.0.1'; process.env.CLAMAV_PORT = String(server.address().port);
      try {
        await assert.rejects(scanFile(file)); reply = 'stream: OK\0'; await scanFile(file);
        await new Promise(resolve => server.close(resolve)); await assert.rejects(scanFile(file));
      } finally { if (server.listening) await new Promise(resolve => server.close(resolve)); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await fs.rm(root, { recursive: true, force: true }); }
    });
    await check('custom role edits cannot change own permissions or cross organization', async () => {
      const created = await request('/admin/roles', { method: 'POST', cookie: admin, data: { name: 'Custom review role', permissions: ['knowledge:create'] } }); assert.equal(created.status, 201);
      assert.equal((await request(`/admin/roles/${created.body.id}`, { method: 'PUT', cookie: admin, data: { name: 'Updated review role', permissions: ['knowledge:create', 'projects:create'] } })).status, 200);
      assert.equal((await request(`/admin/roles/${roles.admin.id}`, { method: 'PUT', cookie: admin, data: { name: 'Self', permissions: [] } })).status, 400);
      assert.equal((await request(`/admin/roles/${roles.foreign.id}`, { method: 'PUT', cookie: admin, data: { name: 'Foreign', permissions: [] } })).status, 404);
      assert.equal((await request(`/admin/roles/${roles.viewer.id}`, { method: 'DELETE', cookie: admin })).status, 409);
      assert.equal((await request(`/admin/roles/${created.body.id}`, { method: 'DELETE', cookie: admin })).status, 200);
    });
    await check('mail settings return JSON defaults before first save without creating a database row', async () => {
      assert.equal(await db.organizationSettings.findUnique({ where: { organizationId: org.id } }), null);
      const initial = await request('/admin/mail', { cookie: admin });
      assert.equal(initial.status, 200); assert.ok(initial.headers.get('content-type')?.includes('application/json'));
      assert.equal(initial.body.imapEnabled, false); assert.equal(initial.body.imapPort, 993);
      assert.equal(initial.body.smtpEnabled, false); assert.equal(initial.body.smtpPort, 465); assert.equal(initial.body.smtpPasswordSet, false);
      assert.equal(initial.body.imapDomain, null); assert.ok(!('smtpSecret' in initial.body));
      assert.equal(await db.organizationSettings.findUnique({ where: { organizationId: org.id } }), null);
      assert.equal((await request('/admin/mail', { cookie: editor })).status, 403);
    });
    const smtpUser = 'fixture', smtpPassword = randomBytes(24).toString('base64url');
    mail = await mailFixture({ smtpUser, smtpPassword, imapPassword: password });
    const settings = { smtpEnabled: true, smtpHost: 'ventilyator-api', smtpPort: mail.smtpPort, smtpMode: 'TLS', smtpUser, smtpPassword, senderEmail: 'fixture@example.org', senderName: 'Ventilyator fixture', imapEnabled: true, imapHost: 'ventilyator-api', imapPort: mail.imapPort, imapDomain: 'example.org', imapAutoCreate: false, imapRoleId: roles.viewer.id };
    await check('mail settings encrypt secrets and never return passwords', async () => {
      assert.equal((await request('/admin/mail', { method: 'PUT', cookie: editor, data: settings })).status, 403);
      const saved = await request('/admin/mail', { method: 'PUT', cookie: admin, data: settings }); assert.equal(saved.status, 200); assert.ok(saved.body.smtpPasswordSet); assert.ok(!JSON.stringify(saved.body).includes(smtpPassword)); assert.ok(!('smtpSecret' in saved.body));
      const stored = await db.organizationSettings.findUnique({ where: { organizationId: org.id } }); assert.ok(stored.smtpSecret && stored.smtpSecret !== smtpPassword);
    });
    await check('SMTP implicit TLS and required STARTTLS are actually verified', async () => {
      assert.equal((await request('/admin/mail/test-smtp', { method: 'POST', cookie: admin })).status, 201);
      settings.smtpPort = mail.starttlsPort; settings.smtpMode = 'STARTTLS'; const { smtpPassword: _, ...withoutPassword } = settings; void _;
      assert.equal((await request('/admin/mail', { method: 'PUT', cookie: admin, data: withoutPassword })).status, 200);
      assert.equal((await request('/admin/mail/test-smtp', { method: 'POST', cookie: admin })).status, 201); assert.ok(mail.authentications() >= 2);
    });
    await check('worker delivers queued email through real TLS SMTP fixture', async () => {
      const queued = await request('/admin/mail/test-email', { method: 'POST', cookie: admin }); assert.equal(queued.status, 201);
      let delivery;
      for (let attempt = 0; attempt < 60; attempt++) { delivery = await db.emailDelivery.findUnique({ where: { notificationId: queued.body.notificationId } }); if (delivery?.status === 'SENT') break; await new Promise(resolve => setTimeout(resolve, 250)); }
      assert.equal(delivery.status, 'SENT'); assert.equal(mail.messages.length, 1); assert.ok(mail.messages[0].recipient.includes(people.admin.email));
    });
    await check('IMAP verifies TLS credentials and refuses implicit local-account linking', async () => {
      assert.equal((await request('/admin/mail/test-imap', { method: 'POST', cookie: admin, data: { email: people.editor.email, password } })).status, 201);
      assert.equal((await request('/auth/login', { method: 'POST', data: { email: people.editor.email, password, provider: 'imap' } })).status, 401);
      assert.equal((await request(`/admin/users/${people.editor.id}/imap`, { method: 'PUT', cookie: admin, data: { enabled: true } })).status, 200);
      assert.equal((await request('/auth/login', { method: 'POST', data: { email: people.editor.email, password, provider: 'imap' } })).status, 201);
    });
    await check('IMAP optional provisioning uses only a nonprivileged role and stores no mail password', async () => {
      settings.imapAutoCreate = true; const { smtpPassword: _, ...withoutPassword } = settings; void _;
      assert.equal((await request('/admin/mail', { method: 'PUT', cookie: admin, data: withoutPassword })).status, 200);
      const email = `auto-${tag}@example.org`; assert.equal((await request('/auth/login', { method: 'POST', data: { email, password, provider: 'imap' } })).status, 201);
      const user = await db.user.findUnique({ where: { email }, include: { roles: true } }); assert.equal(user.passwordHash, null); assert.equal(user.roles[0].roleId, roles.viewer.id);
    });
    await check('administrative password reset revokes sessions and disables login safely', async () => {
      const newPassword = randomBytes(24).toString('base64url'); assert.equal((await request(`/admin/users/${people.editor.id}/password`, { method: 'POST', cookie: admin, data: { password: newPassword } })).status, 201);
      assert.equal((await request('/auth/me', { cookie: editor })).status, 401);
      assert.equal((await request('/auth/login', { method: 'POST', data: { email: people.editor.email, password: newPassword } })).status, 201);
      assert.equal((await request(`/admin/users/${people.editor.id}`, { method: 'PATCH', cookie: admin, data: { active: false } })).status, 200);
      assert.equal((await request('/auth/login', { method: 'POST', data: { email: people.editor.email, password: newPassword } })).status, 401);
      assert.equal((await request(`/admin/users/${people.admin.id}`, { method: 'PATCH', cookie: admin, data: { active: false } })).status, 400);
    });
    console.log(`Ventilyator platform integration: ${count} passed`);
  } finally {
    if (mail) await mail.close();
    const sessions = await db.sessionMetadata.findMany({ where: { user: { organizationId: { in: orgIds } } } }); const redis = new Redis(process.env.REDIS_URL); if (sessions.length) await redis.del(...sessions.map(s => `session:${s.id}`)); redis.disconnect();
    const objects = await db.storageObject.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
    const fs = require('node:fs/promises'), path = require('node:path');
    for (const object of objects) await fs.rm(path.join(process.env.STORAGE_ROOT, 'objects', object.id.slice(0, 2), object.id.slice(2, 4), object.id), { recursive: true, force: true });
    await db.storageObjectVersion.deleteMany({ where: { object: { organizationId: { in: orgIds } } } }); await db.storageObject.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.task.deleteMany({ where: { organizationId: { in: orgIds } } }); await db.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.knowledgeSpace.deleteMany({ where: { organizationId: { in: orgIds } } }); await db.auditEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.user.deleteMany({ where: { organizationId: { in: orgIds } } }); await db.role.deleteMany({ where: { organizationId: { in: orgIds } } }); await db.organization.deleteMany({ where: { id: { in: orgIds } } }); await db.$disconnect();
  }
}
main().catch(error => { console.error('Platform check failed:', error instanceof assert.AssertionError ? error.message : error.code ?? error.name); process.exitCode = 1; });
