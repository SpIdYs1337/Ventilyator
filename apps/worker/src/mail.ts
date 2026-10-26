import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import type { PrismaClient } from '@ventilyator/database';
import { decryptSecret, mailCa, type Config } from '@ventilyator/config';

export async function startMail(db: PrismaClient, config: Config) {
  const queue = new Queue('ventilyator-mail', { connection: { url: config.REDIS_URL }, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 } });
  queue.on('error', () => console.error('Ventilyator mail queue unavailable'));
  const worker = new Worker('ventilyator-mail', async job => {
    if (job.name !== 'deliver') throw new Error('Unsupported mail job');
    const id = String(job.data.id);
    const row = await db.emailDelivery.findUnique({ where: { id }, include: { notification: { include: { user: { include: { preferences: true, roles: { include: { role: { include: { permissions: true } } } } } }, task: { include: { project: { include: { members: true } } } }, page: { include: { space: { include: { members: true } } } } } } } });
    if (!row || row.status === 'SENT' || row.status === 'SKIPPED') return;
    const n = row.notification, user = n.user;
    const permissions = user.roles.filter(r => r.role.organizationId === n.organizationId).flatMap(r => r.role.permissions.map(p => p.permission));
    const canTask = !n.task || (n.task.project.organizationId === user.organizationId && (permissions.includes('projects:manage') || n.task.project.ownerId === user.id || n.task.project.members.some(m => m.userId === user.id)));
    const canPage = !n.page || (n.page.space.organizationId === user.organizationId && (n.page.publishedAt || n.page.authorId === user.id) && (permissions.includes('knowledge:manage') || n.page.space.ownerId === user.id || n.page.space.members.some(m => m.userId === user.id)));
    const settings = await db.organizationSettings.findUnique({ where: { organizationId: n.organizationId } });
    if (!user.active || (!user.preferences?.emailEnabled && !n.eventKey.startsWith('test:')) || !canTask || !canPage || !settings?.smtpEnabled) {
      await db.emailDelivery.update({ where: { id }, data: { status: 'SKIPPED', lastError: 'DISABLED_OR_ACCESS_REVOKED', leaseUntil: null } }); return;
    }
    const claim = await db.emailDelivery.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED', 'SENDING'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { status: 'SENDING', attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 120000) } });
    if (!claim.count) return;
    const transport = nodemailer.createTransport({ host: settings.smtpHost, port: settings.smtpPort, secure: settings.smtpMode === 'TLS', requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: await mailCa() }, ...(settings.smtpUser ? { auth: { user: settings.smtpUser, pass: settings.smtpSecret ? await decryptSecret(config.STORAGE_ROOT, n.organizationId, settings.smtpSecret) : '' } } : {}) });
    try {
      const href = new URL(n.href, config.APP_ORIGIN);
      if (href.origin !== new URL(config.APP_ORIGIN).origin) throw new Error('Invalid notification URL');
      await transport.sendMail({ from: { name: settings.senderName, address: settings.senderEmail }, to: user.email, subject: n.title.slice(0, 200), text: `${n.title}\n\n${href.href}\n\nVentilyator`, messageId: `<${id}@ventilyator.local>` });
      await db.emailDelivery.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), lastError: null, leaseUntil: null } });
    } catch {
      await db.emailDelivery.update({ where: { id }, data: { status: 'FAILED', lastError: 'SMTP_DELIVERY_FAILED', leaseUntil: null } });
      throw new Error('SMTP_DELIVERY_FAILED');
    } finally { transport.close(); }
  }, { connection: { url: config.REDIS_URL }, concurrency: 2 });
  worker.on('error', () => console.error('Ventilyator mail worker unavailable'));
  worker.on('failed', () => console.error('Ventilyator email delivery failed; see delivery log'));
  await worker.waitUntilReady();
  let polling = false;
  const poll = async () => {
    if (polling) return; polling = true;
    try {
      const pending = await db.emailDelivery.findMany({ where: { status: { in: ['PENDING', 'FAILED', 'SENDING'] }, attempts: { lt: 5 }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 100 });
      for (const row of pending) {
        const jobId = `delivery-${row.id}`;
        const previous = await queue.getJob(jobId);
        if (previous) { const state = await previous.getState(); if (state === 'completed' || state === 'failed') await previous.remove(); else continue; }
        await queue.add('deliver', { id: row.id }, { jobId });
      }
    } catch { console.error('Ventilyator outbox poll failed'); }
    finally { polling = false; }
  };
  await poll(); const timer = setInterval(() => { void poll(); }, 5000);
  return { close: async () => { clearInterval(timer); await worker.close(); await queue.close(); } };
}
