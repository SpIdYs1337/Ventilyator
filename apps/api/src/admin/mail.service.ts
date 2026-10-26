import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { decryptSecret, encryptSecret, mailCa } from '@ventilyator/config';
import { mailSettingsSchema } from '@ventilyator/validation';
import type { CurrentUser } from '@ventilyator/shared';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { Infrastructure } from '../infrastructure';
import { input } from '../common/input';

@Injectable()
export class MailService {
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure) {}
  async settings(user: CurrentUser) {
    const settings = await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } });
    if (!settings) return null;
    const { smtpSecret, ...publicSettings } = settings;
    return { ...publicSettings, smtpPasswordSet: Boolean(smtpSecret) };
  }
  async save(user: CurrentUser, body: unknown) {
    const data = input(mailSettingsSchema, body);
    if (data.imapAutoCreate) {
      const role = await this.infra.db.role.findFirst({ where: { id: data.imapRoleId!, organizationId: user.organizationId }, include: { permissions: true } });
      if (!role || role.permissions.some(p => !['knowledge:create'].includes(p.permission))) throw new BadRequestException('Автосоздание IMAP допускается только с непривилегированной ролью');
    }
    const { smtpPassword, ...settings } = data;
    const encrypted = smtpPassword !== undefined && smtpPassword !== '' ? await encryptSecret(this.infra.config.STORAGE_ROOT, user.organizationId, smtpPassword) : undefined;
    await this.infra.db.$transaction(async tx => {
      await tx.organizationSettings.upsert({ where: { organizationId: user.organizationId }, create: { ...settings, smtpSecret: encrypted, organizationId: user.organizationId }, update: { ...settings, ...(encrypted ? { smtpSecret: encrypted } : {}) } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: 'settings.mail_updated' } });
    });
    return this.settings(user);
  }
  async testSmtp(user: CurrentUser) {
    const settings = await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } });
    if (!settings?.smtpEnabled || !settings.smtpHost) throw new BadRequestException('Сначала сохраните и включите SMTP');
    const transport = nodemailer.createTransport({ host: settings.smtpHost, port: settings.smtpPort, secure: settings.smtpMode === 'TLS', requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: await mailCa() }, ...(settings.smtpUser ? { auth: { user: settings.smtpUser, pass: settings.smtpSecret ? await decryptSecret(this.infra.config.STORAGE_ROOT, user.organizationId, settings.smtpSecret) : '' } } : {}) });
    try { await transport.verify(); return { ok: true }; }
    catch { throw new BadRequestException('Не удалось проверить SMTP. Проверьте адрес, TLS, учётные данные и доверенный CA.'); }
    finally { transport.close(); }
  }
  async testEmail(user: CurrentUser) {
    const settings = await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } });
    if (!settings?.smtpEnabled) throw new BadRequestException('SMTP выключен');
    const notification = await this.infra.db.notification.create({ data: { userId: user.id, organizationId: user.organizationId, eventKey: `test:${Date.now()}`, title: 'Тестовое письмо Ventilyator', href: '/notifications', email: { create: {} } } });
    return { ok: true, notificationId: notification.id, queued: true };
  }
  async testImap(user: CurrentUser, email: string, password: string | undefined) {
    const settings = await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } });
    if (!settings?.imapEnabled || !password || email.toLowerCase().split('@')[1] !== settings.imapDomain) throw new BadRequestException('Сохраните IMAP и укажите почту разрешённого домена с паролем');
    const client = new ImapFlow({ host: settings.imapHost, port: settings.imapPort, secure: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: await mailCa() }, auth: { user: email.toLowerCase(), pass: password }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
    try { await client.connect(); return { ok: true }; }
    catch { throw new BadRequestException('Проверка IMAP не прошла. Проверьте TLS, адрес, домен и учётные данные.'); }
    finally { client.close(); }
  }
  async deliveries(user: CurrentUser) {
    return this.infra.db.emailDelivery.findMany({ where: { notification: { organizationId: user.organizationId } }, select: { id: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true, notification: { select: { title: true, user: { select: { email: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
