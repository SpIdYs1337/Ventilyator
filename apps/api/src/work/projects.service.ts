import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ventilyator/database';
import type { CurrentUser, ProjectRole } from '@ventilyator/shared';
import type { CreateProjectInput, UpdateProjectInput } from '@ventilyator/validation';
import { Infrastructure } from '../infrastructure';

export const personSelect = { id: true, name: true, email: true, active: true } as const;
const projectInclude = { owner: { select: personSelect }, members: { include: { user: { select: personSelect } }, orderBy: { userId: 'asc' as const } }, _count: { select: { tasks: true, members: true } } };

@Injectable()
export class ProjectsService {
  constructor(@Inject(Infrastructure) readonly infra: Infrastructure) {}

  visibility(user: CurrentUser): Prisma.ProjectWhereInput {
    return { organizationId: user.organizationId, ...(user.permissions.includes('projects:manage') ? {} : { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] }) };
  }

  async load(user: CurrentUser, id: string, db: Prisma.TransactionClient = this.infra.db) {
    const project = await db.project.findFirst({ where: { id, ...this.visibility(user) }, include: projectInclude });
    if (!project) throw new NotFoundException('Проект не найден');
    const myRole: ProjectRole = user.permissions.includes('projects:manage') || project.ownerId === user.id ? 'MANAGER' : project.members.find(m => m.userId === user.id)!.role;
    return { ...project, myRole };
  }

  async write<T>(user: CurrentUser, id: string, fn: (tx: Prisma.TransactionClient, project: Awaited<ReturnType<ProjectsService['load']>>) => Promise<T>, manage = false, allowArchived = false): Promise<T> {
    return this.infra.db.$transaction(async tx => {
      // Membership changes, archiving and task edits share a lock, preventing ACL TOCTOU races.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const project = await this.load(user, id, tx);
      if (project.myRole === 'VIEWER' || (manage && project.myRole !== 'MANAGER')) throw new ForbiddenException('Недостаточно прав в проекте');
      if (project.archived && !allowArchived) throw new ConflictException('Архивный проект доступен только для чтения');
      return fn(tx, project);
    });
  }

  async list(user: CurrentUser, query: { offset: number; limit: number; archived: string }) {
    const where = { ...this.visibility(user), archived: query.archived === 'true' };
    const [items, total] = await this.infra.db.$transaction([
      this.infra.db.project.findMany({ where, include: { owner: { select: personSelect }, members: { where: { userId: user.id }, select: { role: true } }, _count: { select: { tasks: true, members: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: query.offset, take: query.limit }),
      this.infra.db.project.count({ where }),
    ]);
    return { items: items.map(p => ({ ...p, myRole: user.permissions.includes('projects:manage') || p.ownerId === user.id ? 'MANAGER' : p.members[0]?.role ?? 'VIEWER' })), total, offset: query.offset, limit: query.limit };
  }

  async create(user: CurrentUser, input: CreateProjectInput) {
    if (!user.permissions.includes('projects:create') && !user.permissions.includes('projects:manage')) throw new ForbiddenException('Нет разрешения создавать проекты');
    return this.infra.db.$transaction(async tx => {
      const project = await tx.project.create({ data: { ...input, organizationId: user.organizationId, ownerId: user.id } });
      await tx.projectMember.create({ data: { projectId: project.id, userId: user.id, organizationId: user.organizationId, role: 'MANAGER' } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `project.created:${project.id}` } });
      return project;
    });
  }

  update(user: CurrentUser, id: string, input: UpdateProjectInput) {
    return this.write(user, id, async (tx, project) => {
      const { version, ...data } = input;
      if (project.version !== version) throw new ConflictException('Проект изменён. Обновите страницу перед сохранением.');
      const updated = await tx.project.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `project.updated:${id}` } });
      return updated;
    }, true, true);
  }

  async people(user: CurrentUser, id: string, query: { q: string; offset: number; limit: number }) {
    const project = await this.load(user, id);
    if (project.myRole !== 'MANAGER') throw new ForbiddenException();
    const where: Prisma.UserWhereInput = { organizationId: user.organizationId, active: true, OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] };
    const [items, total] = await this.infra.db.$transaction([
      this.infra.db.user.findMany({ where, select: personSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: query.offset, take: query.limit }),
      this.infra.db.user.count({ where }),
    ]);
    return { items, total, offset: query.offset, limit: query.limit };
  }

  setMember(user: CurrentUser, id: string, input: { userId: string; role: ProjectRole }) {
    return this.write(user, id, async (tx, project) => {
      if (input.userId === project.ownerId) throw new BadRequestException('Роль владельца проекта изменять нельзя');
      if (!await tx.user.findFirst({ where: { id: input.userId, organizationId: user.organizationId, active: true } })) throw new NotFoundException('Активный сотрудник не найден');
      if (project.members.length >= 500 && !project.members.some(m => m.userId === input.userId)) throw new BadRequestException('В проекте уже 500 участников');
      const member = await tx.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: input.userId } }, create: { ...input, projectId: id, organizationId: user.organizationId }, update: { role: input.role } });
      if (input.role === 'VIEWER') await this.clearAssignments(tx, user, id, input.userId);
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `project.member_set:${id}:${input.userId}:${input.role}` } });
      return member;
    }, true);
  }

  removeMember(user: CurrentUser, id: string, userId: string) {
    return this.write(user, id, async (tx, project) => {
      if (userId === project.ownerId) throw new BadRequestException('Нельзя удалить владельца проекта');
      await this.clearAssignments(tx, user, id, userId);
      await tx.projectMember.deleteMany({ where: { projectId: id, userId } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `project.member_removed:${id}:${userId}` } });
      return { ok: true };
    }, true);
  }

  private async clearAssignments(tx: Prisma.TransactionClient, user: CurrentUser, projectId: string, userId: string) {
    const timer = await tx.taskTimer.findFirst({ where: { userId, task: { projectId } } });
    if (timer) {
      await tx.timeEntry.create({ data: { taskId: timer.taskId, organizationId: user.organizationId, userId, startedAt: timer.startedAt, minutes: Math.max(1, Math.min(10080, Math.ceil((Date.now() - timer.startedAt.getTime()) / 60000))), note: 'Таймер остановлен при изменении доступа к проекту' } });
      await tx.taskTimer.delete({ where: { userId } });
    }
    const assigned = await tx.task.findMany({ where: { projectId, assigneeId: userId }, select: { id: true } });
    await tx.task.updateMany({ where: { projectId, assigneeId: userId }, data: { assigneeId: null, version: { increment: 1 } } });
    if (assigned.length) await tx.taskEvent.createMany({ data: assigned.map(task => ({ organizationId: user.organizationId, taskId: task.id, actorId: user.id, action: 'task.updated', changes: { assigneeId: { before: userId, after: null } } })) });
  }
}
