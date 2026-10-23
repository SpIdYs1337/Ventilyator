import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { commentSchema, createProjectSchema, createTaskSchema, memberSchema, pageSchema, peopleSchema, projectListSchema, taskListSchema, updateProjectSchema, updateTaskSchema } from '@ventilyator/validation';
import { AuthService } from '../auth/auth.service';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

function parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException('Проверьте поля запроса');
  return result.data;
}

@ApiTags('projects')
@Controller('projects')
export class WorkController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(TasksService) private readonly tasks: TasksService) {}
  @Get() async list(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query() query: unknown) {
    return this.projects.list(await this.auth.require(req, res), parse(projectListSchema, query));
  }
  @Post() async create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    return this.projects.create(await this.auth.require(req, res), parse(createProjectSchema, body));
  }
  @Get(':projectId') async project(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string) {
    return this.projects.load(await this.auth.require(req, res), id);
  }
  @Patch(':projectId') async updateProject(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.update(await this.auth.require(req, res), id, parse(updateProjectSchema, body));
  }
  @Get(':projectId/people') async people(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.projects.people(await this.auth.require(req, res), id, parse(peopleSchema, query));
  }
  @Put(':projectId/members') async member(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.setMember(await this.auth.require(req, res), id, parse(memberSchema, body));
  }
  @Delete(':projectId/members/:userId') async removeMember(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.projects.removeMember(await this.auth.require(req, res), id, userId);
  }
  @Get(':projectId/tasks') async listTasks(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.tasks.list(await this.auth.require(req, res), id, parse(taskListSchema, query));
  }
  @Post(':projectId/tasks') async createTask(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.create(await this.auth.require(req, res), id, parse(createTaskSchema, body));
  }
  @Get(':projectId/tasks/:taskId') async task(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) id: string) {
    return this.tasks.load(await this.auth.require(req, res), projectId, id);
  }
  @Patch(':projectId/tasks/:taskId') async updateTask(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.update(await this.auth.require(req, res), projectId, id, parse(updateTaskSchema, body));
  }
  @Get(':projectId/tasks/:taskId/comments') async comments(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.tasks.activity(await this.auth.require(req, res), projectId, id, parse(pageSchema, query), 'comments');
  }
  @Get(':projectId/tasks/:taskId/events') async events(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) id: string, @Query() query: unknown) {
    return this.tasks.activity(await this.auth.require(req, res), projectId, id, parse(pageSchema, query), 'events');
  }
  @Post(':projectId/tasks/:taskId/comments') async comment(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('taskId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tasks.comment(await this.auth.require(req, res), projectId, id, parse(commentSchema, body).body);
  }
}
