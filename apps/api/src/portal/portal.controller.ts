import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { peopleSchema, preferencesSchema, myTasksSchema } from '@ventilyator/validation';
import { AuthService } from '../auth/auth.service';
import { input } from '../common/input';
import { PortalService } from './portal.service';
@Controller()
export class PortalController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(PortalService) private readonly portal: PortalService) {}
  @Get('dashboard') async dashboard(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.portal.dashboard(await this.auth.require(req, res)); }
  @Get('my-tasks') async myTasks(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: unknown) { return this.portal.myTasks(await this.auth.require(req, res), input(myTasksSchema, query)); }
  @Get('notifications') async notifications(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: unknown) { const user = await this.auth.require(req, res); const q = input(peopleSchema, query); return this.portal.notifications(user, q.offset, q.q === 'unread'); }
  @Post('notifications/read-all') async readAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.portal.read(await this.auth.require(req, res)); }
  @Post('notifications/:id/read') async read(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string) { return this.portal.read(await this.auth.require(req, res), id); }
  @Put('preferences') async preferences(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) { return this.portal.preferences(await this.auth.require(req, res), input(preferencesSchema, body)); }
  @Get('search') async search(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: unknown) { const q = input(peopleSchema, query); return this.portal.search(await this.auth.require(req, res), q.q); }
  @Get('projects/:id/reports') async reports(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('id', ParseUUIDPipe) id: string) { return this.portal.reports(await this.auth.require(req, res), id); }
}
