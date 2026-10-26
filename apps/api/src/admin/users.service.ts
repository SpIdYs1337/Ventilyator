import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@ventilyator/database';
import type { CurrentUser } from '@ventilyator/shared';
import * as argon2 from 'argon2';
import { Infrastructure } from '../infrastructure';

@Injectable()
export class UsersService {
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure) {}
  private async target(user: CurrentUser, id: string, tx: Prisma.TransactionClient = this.infra.db) {
    const target = await tx.user.findFirst({ where: { id, organizationId: user.organizationId }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
    if (!target) throw new NotFoundException();
    if (target.roles.some(r => r.role.permissions.some(p => !user.permissions.includes(p.permission)))) throw new ForbiddenException('Нельзя изменять более привилегированную учётную запись');
    return target;
  }
  private async administrator(user: CurrentUser, tx: Prisma.TransactionClient, mail = false) {
    const actor = await tx.user.findFirst({ where: { id: user.id, active: true, organizationId: user.organizationId }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
    const permissions = actor?.roles.filter(r => r.role.organizationId === user.organizationId).flatMap(r => r.role.permissions.map(p => p.permission)) ?? [];
    if (!permissions.includes('users:manage') || (mail && !permissions.includes('mail:manage'))) throw new ForbiddenException('Ваш административный доступ отозван');
    return { ...user, permissions };
  }
  async update(user: CurrentUser, id: string, data: { name?: string; active?: boolean; roleId?: string }) {
    await this.target(user, id);
    if (id === user.id && (data.active === false || data.roleId)) throw new BadRequestException('Нельзя отключать собственный доступ или менять свою роль');
    if (data.roleId) {
      const role = await this.infra.db.role.findFirst({ where: { id: data.roleId, organizationId: user.organizationId }, include: { permissions: true } });
      if (!role) throw new NotFoundException();
      if (role.permissions.some(p => !user.permissions.includes(p.permission))) throw new ForbiddenException();
    }
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`users:${user.organizationId}`}))`;
      const current = await this.administrator(user, tx);
      await this.target(current, id, tx);
      if (data.roleId) {
        const role = await tx.role.findFirst({ where: { id: data.roleId, organizationId: user.organizationId }, include: { permissions: true } });
        if (!role) throw new NotFoundException();
        if (role.permissions.some(p => !current.permissions.includes(p.permission))) throw new ForbiddenException();
      }
      if (data.roleId) { await tx.userRole.deleteMany({ where: { userId: id } }); await tx.userRole.create({ data: { userId: id, roleId: data.roleId } }); }
      const updated = await tx.user.update({ where: { id }, data: { ...(data.name ? { name: data.name } : {}), ...(data.active !== undefined ? { active: data.active } : {}) }, select: { id: true, name: true, email: true, active: true } });
      if (data.active === false || data.roleId) await tx.sessionMetadata.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `user.updated:${id}` } });
      return updated;
    });
  }
  async reset(user: CurrentUser, id: string, password: string) {
    await this.target(user, id);
    if (user.id === id) throw new BadRequestException('Для себя используйте смену пароля с проверкой текущего');
    await this.password(id, user, password); return { ok: true };
  }
  async ownPassword(user: CurrentUser, current: string, password: string) {
    const row = await this.infra.db.user.findUnique({ where: { id: user.id } });
    if (!row?.passwordHash || !await argon2.verify(row.passwordHash, current)) throw new UnauthorizedException('Текущий пароль неверен');
    await this.password(user.id, user, password); return { ok: true };
  }
  private async password(id: string, actor: CurrentUser, password: string) {
    const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    await this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`users:${actor.organizationId}`}))`;
      if (actor.id !== id) await this.target(await this.administrator(actor, tx), id, tx);
      await tx.user.update({ where: { id }, data: { passwordHash: hash } });
      await tx.sessionMetadata.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: actor.organizationId, userId: actor.id, action: `user.password_changed:${id}` } });
    });
  }
  async imap(user: CurrentUser, id: string, enabled: boolean) {
    if (!user.permissions.includes('mail:manage')) throw new ForbiddenException();
    const target = await this.target(user, id);
    const settings = await this.infra.db.organizationSettings.findUnique({ where: { organizationId: user.organizationId } });
    if (enabled && (!settings?.imapEnabled || target.email.split('@')[1] !== settings.imapDomain)) throw new BadRequestException('Почта должна принадлежать включённому IMAP-домену организации');
    await this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`users:${user.organizationId}`}))`;
      await this.target(await this.administrator(user, tx, true), id, tx);
      if (enabled) await tx.authIdentity.upsert({ where: { provider_subject: { provider: 'imap', subject: target.email } }, create: { provider: 'imap', subject: target.email, userId: id }, update: {} });
      else await tx.authIdentity.deleteMany({ where: { userId: id, provider: 'imap' } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `user.imap_${enabled ? 'linked' : 'unlinked'}:${id}` } });
    });
    return { ok: true };
  }
}
