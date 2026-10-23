import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ventilyator/database';
import type { CurrentUser } from '@ventilyator/shared';
import type { CreateTaskInput, UpdateTaskInput, TaskListInput } from '@ventilyator/validation';
import { ProjectsService, personSelect } from './projects.service';

const taskInclude = { author: { select: personSelect }, assignee: { select: personSelect } };
const closed = (status: string) => ['DONE', 'CLOSED'].includes(status);

@Injectable()
export class TasksService {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  async list(user: CurrentUser, projectId: string, query: TaskListInput) {
    await this.projects.load(user, projectId);
    const where: Prisma.TaskWhereInput = {
      organizationId: user.organizationId, projectId, ...(query.status ? { status: query.status } : {}),
      ...(query.mine === 'true' ? { assigneeId: user.id } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.projects.infra.db.$transaction([
      this.projects.infra.db.task.findMany({ where, include: taskInclude, orderBy: { number: 'desc' }, skip: query.offset, take: query.limit }),
      this.projects.infra.db.task.count({ where }),
    ]);
    return { items, total, offset: query.offset, limit: query.limit };
  }

  async load(user: CurrentUser, projectId: string, id: string, tx: Prisma.TransactionClient = this.projects.infra.db) {
    await this.projects.load(user, projectId, tx);
    const task = await tx.task.findFirst({ where: { id, projectId, organizationId: user.organizationId }, include: taskInclude });
    if (!task) throw new NotFoundException('Задача не найдена');
    return task;
  }

  private async assignee(tx: Prisma.TransactionClient, user: CurrentUser, projectId: string, assigneeId: string | null | undefined) {
    if (!assigneeId) return;
    const person = await tx.user.findFirst({ where: { id: assigneeId, organizationId: user.organizationId, active: true, projectMemberships: { some: { projectId } } } });
    if (!person) throw new BadRequestException('Исполнитель должен быть активным участником проекта');
    const member = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } });
    if (member?.role === 'VIEWER') throw new BadRequestException('Наблюдатель не может быть исполнителем');
  }

  create(user: CurrentUser, projectId: string, input: CreateTaskInput) {
    return this.projects.write(user, projectId, async tx => {
      await this.assignee(tx, user, projectId, input.assigneeId);
      const project = await tx.project.update({ where: { id: projectId }, data: { nextTaskNumber: { increment: 1 } } });
      const task = await tx.task.create({ data: { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null, projectId, organizationId: user.organizationId, authorId: user.id, number: project.nextTaskNumber }, include: taskInclude });
      await tx.taskEvent.create({ data: { taskId: task.id, organizationId: user.organizationId, actorId: user.id, action: 'task.created', changes: {} } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `task.created:${task.id}` } });
      return task;
    });
  }

  update(user: CurrentUser, projectId: string, id: string, input: UpdateTaskInput) {
    return this.projects.write(user, projectId, async tx => {
      const previous = await this.load(user, projectId, id, tx);
      const { version, ...fields } = input;
      if (previous.version !== version) throw new ConflictException('Задача изменена другим сотрудником. Обновите её и повторите изменение.');
      await this.assignee(tx, user, projectId, input.assigneeId);
      const changes: Record<string, Prisma.InputJsonValue> = {};
      for (const [key, after] of Object.entries(fields)) {
        const value = previous[key as keyof typeof fields];
        const before = value instanceof Date ? value.toISOString() : value ?? null;
        if (before !== after) changes[key] = { before, after: after ?? null };
      }
      if (!Object.keys(changes).length) return previous;
      const status = input.status ?? previous.status;
      const completedAt = closed(status) ? (previous.completedAt ?? new Date()) : null;
      const task = await tx.task.update({ where: { id }, data: { ...fields, ...(fields.dueAt !== undefined ? { dueAt: fields.dueAt ? new Date(fields.dueAt) : null } : {}), completedAt, version: { increment: 1 } }, include: taskInclude });
      await tx.taskEvent.create({ data: { taskId: id, organizationId: user.organizationId, actorId: user.id, action: 'task.updated', changes } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `task.updated:${id}` } });
      return task;
    });
  }

  async activity(user: CurrentUser, projectId: string, id: string, query: { offset: number; limit: number }, kind: 'comments' | 'events') {
    await this.load(user, projectId, id);
    const where = { taskId: id, organizationId: user.organizationId };
    const db = this.projects.infra.db;
    if (kind === 'comments') {
      const [items, total] = await db.$transaction([db.taskComment.findMany({ where, include: { author: { select: personSelect } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: query.offset, take: query.limit }), db.taskComment.count({ where })]);
      return { items, total, ...query };
    }
    const [items, total] = await db.$transaction([db.taskEvent.findMany({ where, include: { actor: { select: personSelect } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: query.offset, take: query.limit }), db.taskEvent.count({ where })]);
    return { items, total, ...query };
  }

  comment(user: CurrentUser, projectId: string, id: string, body: string) {
    return this.projects.write(user, projectId, async tx => {
      await this.load(user, projectId, id, tx);
      const comment = await tx.taskComment.create({ data: { body, taskId: id, organizationId: user.organizationId, authorId: user.id }, include: { author: { select: personSelect } } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `task.commented:${id}` } });
      return comment;
    });
  }
}
