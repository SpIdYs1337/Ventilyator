import { Controller, Get, Post, Delete, Param, Body, Req, Res, BadRequestException, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { loginSchema } from '@ventilyator/validation';
import { Infrastructure } from '../infrastructure';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Infrastructure) private readonly infra: Infrastructure) {}
  @Post('login') async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте email и пароль');
    return this.auth.login(parsed.data, req, res);
  }
  @Get('me') me(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.require(req, res); }
  @Get('sessions') async sessions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.require(req, res);
    const id = this.auth.sessionId(req).id;
    const rows = await this.infra.db.sessionMetadata.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, createdAt: true, expiresAt: true, userAgent: true } });
    const active = rows.length ? await this.infra.redis.mget(...rows.map(s => `session:${s.id}`)) : [];
    return rows.filter((_, i) => active[i] !== null).map(s => ({ ...s, current: s.id === id }));
  }
  @Delete('sessions/:id') async revoke(@Param('id') id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.require(req, res);
    await this.auth.revoke(user, id);
    if (id === this.auth.sessionId(req).id) res.clearCookie('ventilyator_session', { path: '/' });
    return { ok: true };
  }
  @Post('logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.require(req, res);
    await this.auth.revoke(user, this.auth.sessionId(req).id);
    res.clearCookie('ventilyator_session', { path: '/' });
    return { ok: true };
  }
  @Post('logout-all') async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.require(req, res);
    await this.auth.revoke(user, '', true);
    res.clearCookie('ventilyator_session', { path: '/' });
    return { ok: true };
  }
}
