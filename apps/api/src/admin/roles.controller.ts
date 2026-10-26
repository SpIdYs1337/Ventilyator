import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Inject, NotFoundException, Param, ParseUUIDPipe, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createRoleSchema } from '@ventilyator/validation';
import { permissionKeys } from '@ventilyator/shared';
import { AuthService } from '../auth/auth.service';
import { Infrastructure } from '../infrastructure';
import { input } from '../common/input';
@Controller('admin/roles')
export class RolesController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Infrastructure) private readonly infra: Infrastructure) {}
  @Put(':id') async update(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const user = await this.auth.require(req, res, 'roles:manage'); const data = input(createRoleSchema, body);
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`users:${user.organizationId}`}))`;
      const actor = await tx.user.findFirst({ where: { id: user.id, active: true }, include: { roles: { include: { role: { include: { permissions: true } } } } } });
      const permissions = actor?.roles.filter(r => r.role.organizationId === user.organizationId).flatMap(r => r.role.permissions.map(p => p.permission)) ?? [];
      if (!permissions.includes('roles:manage') || data.permissions.some(p => !permissionKeys.includes(p as typeof permissionKeys[number]) || !permissions.includes(p))) throw new ForbiddenException();
      const role = await tx.role.findFirst({ where: { id, organizationId: user.organizationId }, include: { permissions: true, users: { where: { userId: user.id } } } });
      if (!role) throw new NotFoundException();
      if (role.permissions.some(p => !permissions.includes(p.permission))) throw new ForbiddenException();
      const next = [...new Set(data.permissions)];
      if (role.users.length && (next.length !== role.permissions.length || role.permissions.some(p => !next.includes(p.permission)))) throw new BadRequestException('Нельзя менять разрешения собственной роли');
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (next.length) await tx.rolePermission.createMany({ data: next.map(permission => ({ roleId: id, permission })) });
      await tx.role.update({ where: { id }, data: { name: data.name } });
      const members = await tx.userRole.findMany({ where: { roleId: id }, select: { userId: true } });
      if (members.length) await tx.sessionMetadata.updateMany({ where: { userId: { in: members.map(m => m.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `role.updated:${id}` } });
      return { ok: true };
    });
  }
  @Delete(':id') async remove(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.auth.require(req, res, 'roles:manage');
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`users:${user.organizationId}`}))`;
      const role = await tx.role.findFirst({ where: { id, organizationId: user.organizationId }, include: { permissions: true, _count: { select: { users: true } } } });
      if (!role) throw new NotFoundException();
      if (role.permissions.some(p => !user.permissions.includes(p.permission))) throw new ForbiddenException();
      if (role._count.users) throw new ConflictException('Сначала переназначьте сотрудников этой роли');
      await tx.role.delete({ where: { id } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `role.deleted:${id}` } });
      return { ok: true };
    });
  }
}
