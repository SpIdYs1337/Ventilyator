import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ventilyator/database';
import { defaultWorkflow, type CurrentUser, type Workflow } from '@ventilyator/shared';
import { ProjectsService, personSelect } from './projects.service';
import { TasksService } from './tasks.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Injectable()
export class PlanningService {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(TasksService) private readonly tasks: TasksService, @Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}
  async sprints(user: CurrentUser, projectId: string) {
    await this.projects.load(user, projectId);
    return this.projects.infra.db.sprint.findMany({ where: { projectId }, include: { _count: { select: { tasks: true } } }, orderBy: { startsAt: 'desc' }, take: 100 });
  }
  createSprint(user: CurrentUser, projectId: string, data: { name: string; goal: string; startsAt: string; endsAt: string }) {
    return this.projects.write(user, projectId, async tx => {
      const sprint = await tx.sprint.create({ data: { ...data, startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), projectId, organizationId: user.organizationId } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `sprint.created:${sprint.id}` } });
      return sprint;
    }, true);
  }
  sprintState(user: CurrentUser, projectId: string, id: string, status: 'ACTIVE' | 'CLOSED') {
    return this.projects.write(user, projectId, async (tx, project) => {
      const sprint = await tx.sprint.findFirst({ where: { id, projectId, organizationId: user.organizationId } });
      if (!sprint) throw new NotFoundException();
      if ((status === 'ACTIVE' && sprint.status !== 'PLANNED') || (status === 'CLOSED' && sprint.status !== 'ACTIVE')) throw new ConflictException('Неверный переход состояния спринта');
      if (status === 'ACTIVE' && await tx.sprint.count({ where: { projectId, status: 'ACTIVE' } })) throw new ConflictException('В проекте уже есть активный спринт');
      const tasks = await tx.task.findMany({ where: { sprintId: id } });
      const workflow = (project.workflow as unknown as Workflow | null) ?? defaultWorkflow;
      const completed = tasks.filter(t => workflow.statuses.some(s => s.key === t.status && s.done));
      const result = { total: tasks.length, completed: completed.length, points: tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0), completedPoints: completed.reduce((n, t) => n + (t.storyPoints ?? 0), 0) };
      const updated = await tx.sprint.update({ where: { id }, data: { status, ...(status === 'CLOSED' ? { completedAt: new Date(), result } : {}) } });
      if (status === 'CLOSED') {
        const unfinished = tasks.filter(t => !completed.some(done => done.id === t.id));
        await tx.task.updateMany({ where: { sprintId: id, id: { notIn: completed.map(t => t.id) } }, data: { sprintId: null, version: { increment: 1 } } });
        if (unfinished.length) await tx.taskEvent.createMany({ data: unfinished.map(t => ({ taskId: t.id, organizationId: user.organizationId, actorId: user.id, action: 'task.updated', changes: { sprintId: { before: id, after: null } } })) });
      }
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `sprint.${status.toLowerCase()}:${id}` } });
      return updated;
    }, true);
  }
  workflow(user: CurrentUser, projectId: string, workflow: Workflow, version: number) {
    return this.projects.write(user, projectId, async (tx, project) => {
      if (!Number.isInteger(version) || version !== project.version) throw new ConflictException('Обновите настройки проекта перед сохранением процесса');
      const current = await tx.task.findMany({ where: { projectId }, select: { status: true }, distinct: ['status'] });
      const old = (project.workflow as unknown as Workflow | null) ?? defaultWorkflow;
      if (current.some(t => !workflow.statuses.some(s => s.key === t.status) || workflow.statuses.find(s => s.key === t.status)?.done !== old.statuses.find(s => s.key === t.status)?.done) || workflow.statuses.find(s => s.key === 'NEW')?.done) throw new BadRequestException('Нельзя удалить используемый статус, изменить его признак завершения или завершить статус NEW');
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `project.workflow_updated:${projectId}` } });
      return tx.project.update({ where: { id: projectId }, data: { workflow: workflow as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
    }, true);
  }
  async details(user: CurrentUser, projectId: string, id: string) {
    await this.tasks.load(user, projectId, id);
    const db = this.projects.infra.db;
    const [checklist, dependencies, children, timeEntries, watches, timer, links] = await Promise.all([
      db.checklistItem.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' } }),
      db.taskDependency.findMany({ where: { taskId: id }, include: { dependsOn: { select: { id: true, number: true, title: true, status: true, projectId: true } } } }),
      db.task.findMany({ where: { parentId: id }, select: { id: true, number: true, title: true, status: true }, orderBy: { number: 'asc' }, take: 200 }),
      db.timeEntry.findMany({ where: { taskId: id }, include: { user: { select: personSelect } }, orderBy: { startedAt: 'desc' }, take: 200 }),
      db.taskWatch.findMany({ where: { taskId: id }, include: { user: { select: personSelect } } }),
      db.taskTimer.findUnique({ where: { userId: user.id } }),
      db.pageTaskLink.findMany({ where: { taskId: id, page: { space: this.knowledge.visibility(user), OR: [{ publishedAt: { not: null } }, { authorId: user.id }] } }, include: { page: { select: { id: true, spaceId: true, title: true } } } }),
    ]);
    return { checklist, dependencies, children, timeEntries, watches, timer, links };
  }
  checklist(user: CurrentUser, projectId: string, id: string, data: { label: string; done: boolean } | { itemId: string; done: boolean } | { itemId: string; remove: true }) {
    return this.projects.write(user, projectId, async tx => {
      await this.tasks.load(user, projectId, id, tx);
      if ('label' in data) {
        if (await tx.checklistItem.count({ where: { taskId: id } }) >= 200) throw new BadRequestException('Лимит 200 пунктов');
        return tx.checklistItem.create({ data: { ...data, taskId: id, organizationId: user.organizationId } });
      }
      if (!await tx.checklistItem.findFirst({ where: { id: data.itemId, taskId: id } })) throw new NotFoundException();
      if ('remove' in data) await tx.checklistItem.delete({ where: { id: data.itemId } });
      else await tx.checklistItem.update({ where: { id: data.itemId }, data: { done: data.done } });
      return { ok: true };
    });
  }
  dependency(user: CurrentUser, projectId: string, id: string, dependsOnId: string, remove: boolean) {
    return this.projects.write(user, projectId, async tx => {
      await this.tasks.load(user, projectId, id, tx);
      await this.tasks.load(user, projectId, dependsOnId, tx);
      if (remove) { await tx.taskDependency.deleteMany({ where: { taskId: id, dependsOnId } }); return { ok: true }; }
      const edges = await tx.taskDependency.findMany({ where: { task: { projectId } } });
      const seen = new Set<string>(); const todo = [dependsOnId];
      while (todo.length) {
        const node = todo.pop()!;
        if (node === id) throw new BadRequestException('Циклическая зависимость');
        if (seen.has(node)) continue;
        seen.add(node);
        todo.push(...edges.filter(e => e.taskId === node).map(e => e.dependsOnId));
      }
      return tx.taskDependency.upsert({ where: { taskId_dependsOnId: { taskId: id, dependsOnId } }, create: { taskId: id, dependsOnId, organizationId: user.organizationId }, update: {} });
    });
  }
  time(user: CurrentUser, projectId: string, id: string, data: { minutes: number; note: string; startedAt: string }) {
    return this.projects.write(user, projectId, async tx => {
      await this.tasks.load(user, projectId, id, tx);
      return tx.timeEntry.create({ data: { ...data, taskId: id, userId: user.id, organizationId: user.organizationId, startedAt: new Date(data.startedAt) }, include: { user: { select: personSelect } } });
    });
  }
  removeTime(user: CurrentUser, projectId: string, id: string, entryId: string) {
    return this.projects.write(user, projectId, async (tx, project) => {
      await this.tasks.load(user, projectId, id, tx);
      const entry = await tx.timeEntry.findFirst({ where: { id: entryId, taskId: id } });
      if (!entry) throw new NotFoundException();
      if (entry.userId !== user.id && project.myRole !== 'MANAGER') throw new ForbiddenException();
      await tx.timeEntry.delete({ where: { id: entryId } }); return { ok: true };
    });
  }
  timer(user: CurrentUser, projectId: string, id: string, stop: boolean) {
    return this.projects.write(user, projectId, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`timer:${user.id}`}))`;
      await this.tasks.load(user, projectId, id, tx);
      const timer = await tx.taskTimer.findUnique({ where: { userId: user.id } });
      if (!stop) {
        if (timer) throw new ConflictException('Уже работает таймер другой задачи');
        return tx.taskTimer.create({ data: { userId: user.id, taskId: id, organizationId: user.organizationId } });
      }
      if (!timer || timer.taskId !== id) throw new NotFoundException();
      await tx.taskTimer.delete({ where: { userId: user.id } });
      return tx.timeEntry.create({ data: { userId: user.id, taskId: id, organizationId: user.organizationId, startedAt: timer.startedAt, minutes: Math.max(1, Math.min(10080, Math.ceil((Date.now() - timer.startedAt.getTime()) / 60000))), note: 'Таймер' } });
    });
  }
  watch(user: CurrentUser, projectId: string, id: string, enabled: boolean) {
    return this.projects.write(user, projectId, async tx => {
      await this.tasks.load(user, projectId, id, tx);
      if (enabled) await tx.taskWatch.upsert({ where: { taskId_userId: { taskId: id, userId: user.id } }, create: { taskId: id, userId: user.id, organizationId: user.organizationId }, update: {} });
      else await tx.taskWatch.deleteMany({ where: { taskId: id, userId: user.id } });
      return { ok: true };
    });
  }
  async pageLink(user: CurrentUser, projectId: string, id: string, pageId: string, remove: boolean) {
    const page = await this.projects.infra.db.knowledgePage.findFirst({ where: { id: pageId, organizationId: user.organizationId } });
    if (!page) throw new NotFoundException();
    await this.knowledge.page(user, page.spaceId, pageId);
    return this.projects.write(user, projectId, async tx => {
      await this.tasks.load(user, projectId, id, tx);
      if (remove) await tx.pageTaskLink.deleteMany({ where: { taskId: id, pageId } });
      else await tx.pageTaskLink.upsert({ where: { pageId_taskId: { taskId: id, pageId } }, create: { taskId: id, pageId, organizationId: user.organizationId }, update: {} });
      return { ok: true };
    });
  }
}
