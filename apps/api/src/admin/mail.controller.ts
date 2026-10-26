import { Body, Controller, Get, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { mailTestSchema } from '@ventilyator/validation';
import { AuthService } from '../auth/auth.service';
import { input } from '../common/input';
import { MailService } from './mail.service';
@Controller('admin/mail')
export class MailController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(MailService) private readonly mail: MailService) {}
  @Get() async get(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.mail.settings(await this.auth.require(req, res, 'mail:manage')); }
  @Put() async save(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { return this.mail.save(await this.auth.require(req, res, 'mail:manage'), body); }
  @Post('test-smtp') async smtp(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.mail.testSmtp(await this.auth.require(req, res, 'mail:manage')); }
  @Post('test-email') async email(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.mail.testEmail(await this.auth.require(req, res, 'mail:manage')); }
  @Post('test-imap') async imap(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { const data = input(mailTestSchema, body); return this.mail.testImap(await this.auth.require(req, res, 'mail:manage'), data.email, data.password); }
  @Get('deliveries') async deliveries(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.mail.deliveries(await this.auth.require(req, res, 'mail:manage')); }
}
