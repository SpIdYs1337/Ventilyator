import { Controller, Get, Post, Body, Req, Res, Param, Query, Delete, BadRequestException, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createUserSchema, createRoleSchema, peopleSchema } from '@ventilyator/validation';
import { input } from '../common/input';
import { permissionKeys } from '@ventilyator/shared';
import * as argon2 from 'argon2';
import { Infrastructure } from '../infrastructure';
import { AuthService } from '../auth/auth.service';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Infrastructure) private readonly infra: Infrastructure) {}
  @Get('system') async system(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.require(req, res, 'system:read');
    return this.infra.status();
  }
  @Get('users') async users(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: unknown) {
    const u = await this.auth.require(req, res, 'users:manage');
    const q = input(peopleSchema, query);
    return this.infra.db.user.findMany({ where: { organizationId: u.organizationId, OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] }, take: q.limit, skip: q.offset, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, email: true, name: true, active: true, createdAt: true, roles: { select: { role: { select: { id: true, name: true } } } }, identities: { select: { provider: true } } } });
  }
  @Post('users') async createUser(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = await this.auth.require(req, res, 'users:manage');
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Некорректные данные пользователя: пароль от 14 символов');
    const { email, name, password, roleId } = parsed.data;
    if (!await this.infra.db.role.findFirst({ where: { id: roleId, organizationId: u.organizationId } })) throw new NotFoundException();
    // A user manager cannot grant permissions they do not possess.
    const grants = await this.infra.db.rolePermission.findMany({ where: { roleId } });
    if (grants.some(p => !u.permissions.includes(p.permission))) throw new BadRequestException('Нельзя делегировать отсутствующие разрешения');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    return this.infra.db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name, passwordHash, organizationId: u.organizationId, roles: { create: { roleId } } }, select: { id: true, name: true, email: true } });
      await tx.auditEvent.create({ data: { organizationId: u.organizationId, userId: u.id, action: 'user.created' } });
      return user;
    });
  }
  @Get('roles') async roles(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = await this.auth.require(req, res);
    if (!u.permissions.some(p => ['users:manage', 'roles:manage', 'mail:manage'].includes(p))) throw new ForbiddenException();
    return this.infra.db.role.findMany({ where: { organizationId: u.organizationId }, include: { permissions: true, users: { where: { userId: u.id }, select: { userId: true } }, _count: { select: { users: true } } }, take: 100 });
  }
  @Post('roles') async createRole(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = await this.auth.require(req, res, 'roles:manage');
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success || parsed.data.permissions.some(p => !permissionKeys.includes(p as typeof permissionKeys[number]) || !u.permissions.includes(p))) throw new BadRequestException();
    return this.infra.db.$transaction(async tx => {
      const role = await tx.role.create({ data: { organizationId: u.organizationId, name: parsed.data.name, permissions: { create: [...new Set(parsed.data.permissions)].map(permission => ({ permission })) } } });
      await tx.auditEvent.create({ data: { organizationId: u.organizationId, userId: u.id, action: 'role.created' } });
      return role;
    });
  }
  @Get('audit') async audit(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = await this.auth.require(req, res, 'audit:read');
    return this.infra.db.auditEvent.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, action: true, createdAt: true, userId: true } });
  }
  @Delete('sessions/:id') async revoke(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const u = await this.auth.require(req, res, 'sessions:revoke');
    const session = await this.infra.db.sessionMetadata.findFirst({ where: { id, user: { organizationId: u.organizationId } }, include: { user: true } });
    if (!session) throw new NotFoundException();
    await this.infra.db.$transaction([
      this.infra.db.sessionMetadata.update({ where: { id }, data: { revokedAt: new Date() } }),
      this.infra.db.auditEvent.create({ data: { organizationId: u.organizationId, userId: u.id, action: 'session.admin_revoked' } }),
    ]);
    await this.infra.redis.del(`session:${id}`);
    return { ok: true };
  }
}
