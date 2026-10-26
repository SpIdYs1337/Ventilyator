import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { fileUpdateSchema, quotaSchema, uploadSchema } from '@ventilyator/validation';
import { input } from '../common/input';
import { AuthService } from '../auth/auth.service';
import { FilesService } from './files.service';
@Controller('files')
export class FilesController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(FilesService) private readonly files: FilesService) {}
  @Get('task/:id') async task(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Query('trash') trash: string) { return this.files.list(await this.auth.require(req, res), { taskId: id, pageId: null }, trash === 'true'); }
  @Get('page/:id') async page(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Query('trash') trash: string) { return this.files.list(await this.auth.require(req, res), { pageId: id, taskId: null }, trash === 'true'); }
  @Post('task/:id/uploads') async taskTicket(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.files.ticket(await this.auth.require(req, res), { taskId: id, pageId: null }, input(uploadSchema, body)); }
  @Post('page/:id/uploads') async pageTicket(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.files.ticket(await this.auth.require(req, res), { pageId: id, taskId: null }, input(uploadSchema, body)); }
  @Put('uploads/:id') async upload(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string) { return this.files.upload(await this.auth.require(req, res), id, req); }
  @Get('status') async status(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.files.status(await this.auth.require(req, res, 'storage:manage')); }
  @Put('quota') async quota(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { return this.files.quota(await this.auth.require(req, res, 'storage:manage'), input(quotaSchema, body).bytes); }
  @Post('reconcile') async reconcile(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.files.reconcile(await this.auth.require(req, res, 'storage:manage')); }
  @Get(':id/download') async download(@Req() req: Request, @Res() res: Response, @Param('id', ParseUUIDPipe) id: string, @Query('version') version: string, @Query('inline') inline: string) { await this.files.download(await this.auth.require(req, res), id, /^[1-9][0-9]{0,8}$/.test(version ?? '') ? Number(version) : undefined, inline === '1', res); }
  @Patch(':id') async update(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.files.update(await this.auth.require(req, res), id, input(fileUpdateSchema, body)); }
}
