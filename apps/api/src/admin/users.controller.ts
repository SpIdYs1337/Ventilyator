import { Body, Controller, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { changePasswordSchema, imapLinkSchema, resetPasswordSchema, userUpdateSchema } from '@ventilyator/validation';
import { AuthService } from '../auth/auth.service';
import { input } from '../common/input';
import { UsersService } from './users.service';
@Controller()
export class UsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(UsersService) private readonly users: UsersService) {}
  @Patch('admin/users/:id') async update(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.users.update(await this.auth.require(req, res, 'users:manage'), id, input(userUpdateSchema, body)); }
  @Post('admin/users/:id/password') async reset(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.users.reset(await this.auth.require(req, res, 'users:manage'), id, input(resetPasswordSchema, body).password); }
  @Put('admin/users/:id/imap') async imap(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.users.imap(await this.auth.require(req, res, 'users:manage'), id, input(imapLinkSchema, body).enabled); }
  @Post('auth/password') async own(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { const user = await this.auth.require(req, res); const data = input(changePasswordSchema, body); const result = await this.users.ownPassword(user, data.currentPassword, data.password); res.clearCookie('ventilyator_session', { path: '/' }); return result; }
}
