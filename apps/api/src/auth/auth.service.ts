import { Injectable, Inject, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import { Infrastructure } from '../infrastructure';
import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import type { CurrentUser } from '@ventilyator/shared';
import { ImapFlow } from 'imapflow';
import { mailCa } from '@ventilyator/config';

const DAY = 86400;
export const hashSession = (raw: string) => createHash('sha256').update(raw).digest('hex');
type Session = { userId: string; absolute: number; idle: number };

@Injectable()
export class AuthService {
  private dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure) {}

  async throttle(email: string, ip: string) {
    for (const [key, max] of [[`email:${hashSession(email)}`, 12], [`ip:${hashSession(ip)}`, 100]] as const) {
      const count = Number(await this.infra.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", 1, `login-limit:${key}`));
      if (count > max) throw new HttpException('Слишком много попыток. Повторите через 15 минут.', 429);
    }
  }

  async login(body: { email: string; password: string; remember: boolean; provider: 'local' | 'imap' }, req: Request, res: Response) {
    await this.throttle(body.email, req.ip ?? 'unknown');
    let user = await this.infra.db.user.findUnique({ where: { email: body.email }, include: { identities: true } });
    let valid = false;
    if (body.provider === 'local') {
      valid = await argon2.verify(user?.passwordHash ?? await this.dummyHash, body.password);
    } else {
      const c = this.infra.config;
      const domain = body.email.split('@')[1]!;
      const settings = user ? await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } }) : await this.infra.db.organizationSettings.findUnique({ where: { imapDomain: domain } });
      const enabled = settings ? settings.imapEnabled && settings.imapDomain === domain : Boolean(user && c.IMAP_HOST && c.IMAP_DOMAIN?.toLowerCase() === domain && user.organizationId === c.IMAP_ORGANIZATION_ID);
      // Existing accounts must be linked explicitly by an authorized administrator.
      const linked = user ? user.active && user.identities.some(i => i.provider === 'imap' && i.subject === body.email) : Boolean(settings?.imapAutoCreate && settings.imapRoleId);
      if (enabled && linked) {
        const client = new ImapFlow({ host: settings?.imapHost ?? c.IMAP_HOST!, port: settings?.imapPort ?? c.IMAP_PORT, secure: true, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: await mailCa() }, auth: { user: body.email, pass: body.password }, logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
        try { await client.connect(); valid = true; } catch { valid = false; } finally { client.close(); }
        if (valid && !user && settings?.imapRoleId) {
          user = await this.infra.db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`identity:${body.email}`}))`;
            const existing = await tx.user.findUnique({ where: { email: body.email }, include: { identities: true } });
            if (existing) return existing.organizationId === settings.organizationId && existing.identities.some(i => i.provider === 'imap' && i.subject === body.email) ? existing : null;
            const role = await tx.role.findFirst({ where: { id: settings.imapRoleId!, organizationId: settings.organizationId }, include: { permissions: true } });
            if (!role || role.permissions.some(p => p.permission !== 'knowledge:create')) return null;
            const created = await tx.user.create({ data: { email: body.email, name: body.email.split('@')[0]!, organizationId: settings.organizationId, identities: { create: { provider: 'imap', subject: body.email } }, roles: { create: { roleId: role.id } } }, include: { identities: true } });
            await tx.auditEvent.create({ data: { organizationId: settings.organizationId, userId: created.id, action: 'user.imap_provisioned' } });
            return created;
          });
        }
      }
    }
    if (!user?.active || !valid) {
      if (user) await this.infra.db.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: 'auth.login_failed' } });
      throw new UnauthorizedException('Неверные учётные данные');
    }
    const raw = randomBytes(32).toString('base64url');
    const id = hashSession(raw);
    const idle = (body.remember ? 30 : 7) * DAY;
    const absolute = Date.now() + this.infra.config.SESSION_MAX_DAYS * DAY * 1000;
    // A per-user transaction lock keeps the session cap valid for simultaneous logins.
    await this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const previous = await tx.sessionMetadata.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, skip: 9 });
      if (previous.length) await tx.sessionMetadata.updateMany({ where: { id: { in: previous.map(s => s.id) } }, data: { revokedAt: new Date() } });
      await tx.sessionMetadata.create({ data: { id, userId: user.id, expiresAt: new Date(absolute), userAgent: (req.get('user-agent') ?? 'unknown').slice(0, 256) } });
      await tx.auditEvent.create({ data: { userId: user.id, organizationId: user.organizationId, action: 'auth.login' } });
    });
    await this.infra.redis.set(`session:${id}`, JSON.stringify({ userId: user.id, idle, absolute } satisfies Session), 'EX', Math.min(idle, Math.ceil((absolute - Date.now()) / 1000)));
    this.cookie(res, raw, Math.min(idle * 1000, absolute - Date.now()));
    return { ok: true };
  }

  private cookie(res: Response, value: string, maxAge: number) {
    res.cookie('ventilyator_session', value, { httpOnly: true, secure: this.infra.config.APP_ORIGIN.startsWith('https://'), sameSite: 'lax', path: '/', maxAge });
  }

  sessionId(req: Request) {
    const value: unknown = req.cookies?.ventilyator_session;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new UnauthorizedException();
    return { raw: value, id: hashSession(value) };
  }

  async require(req: Request, res: Response, permission?: string): Promise<CurrentUser> {
    const { id, raw } = this.sessionId(req);
    const stored = await this.infra.redis.get(`session:${id}`);
    if (!stored) throw new UnauthorizedException();
    const session = JSON.parse(stored) as Session;
    const metadata = await this.infra.db.sessionMetadata.findUnique({ where: { id }, include: { user: { include: { roles: { include: { role: { include: { permissions: true } } } } } } } });
    if (!metadata || metadata.revokedAt || !metadata.user.active || metadata.userId !== session.userId || session.absolute <= Date.now() || metadata.expiresAt.getTime() <= Date.now()) {
      await this.infra.redis.del(`session:${id}`);
      throw new UnauthorizedException();
    }
    const user = metadata.user;
    const permissions = [...new Set(user.roles.filter(r => r.role.organizationId === user.organizationId).flatMap(r => r.role.permissions.map(p => p.permission)))];
    if (permission && !permissions.includes(permission)) throw new ForbiddenException();
    const ttl = Math.min(session.idle, Math.ceil((session.absolute - Date.now()) / 1000));
    await this.infra.redis.expire(`session:${id}`, ttl);
    this.cookie(res, raw, ttl * 1000);
    return { id: user.id, organizationId: user.organizationId, email: user.email, name: user.name, permissions };
  }

  async revoke(user: CurrentUser, id: string, all = false) {
    const where = { userId: user.id, ...(all ? {} : { id }), revokedAt: null };
    const sessions = await this.infra.db.sessionMetadata.findMany({ where });
    await this.infra.db.$transaction([
      this.infra.db.sessionMetadata.updateMany({ where, data: { revokedAt: new Date() } }),
      this.infra.db.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: all ? 'auth.logout_all' : 'auth.logout' } }),
    ]);
    if (sessions.length) await this.infra.redis.del(...sessions.map(s => `session:${s.id}`));
  }
}
