import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@ventilyator/database';
import { defaultWorkflow, documentText, type CurrentUser, type RichNode, type ProjectRole, type Workflow } from '@ventilyator/shared';
import { Infrastructure } from '../infrastructure';
import { ProjectsService, personSelect } from '../work/projects.service';
import { pageNotifications } from '../notifications/events';

const pageSummary = { id: true, spaceId: true, parentId: true, title: true, revision: true, sortOrder: true, archived: true, publishedAt: true, updatedAt: true, author: { select: personSelect } } as const;
@Injectable()
export class KnowledgeService {
  constructor(@Inject(Infrastructure) readonly infra: Infrastructure, @Inject(ProjectsService) private readonly projects: ProjectsService) {}
  visibility(user: CurrentUser): Prisma.KnowledgeSpaceWhereInput {
    return { organizationId: user.organizationId, ...(user.permissions.includes('knowledge:manage') ? {} : { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] }) };
  }
  async space(user: CurrentUser, id: string, tx: Prisma.TransactionClient = this.infra.db) {
    const space = await tx.knowledgeSpace.findFirst({ where: { id, ...this.visibility(user) }, include: { members: { include: { user: { select: personSelect } } }, _count: { select: { pages: true, members: true } } } });
    if (!space) throw new NotFoundException('Пространство не найдено');
    const myRole: ProjectRole = user.permissions.includes('knowledge:manage') || space.ownerId === user.id ? 'MANAGER' : space.members.find(m => m.userId === user.id)!.role;
    return { ...space, myRole };
  }
  pageVisibility(user: CurrentUser, manager: boolean): Prisma.KnowledgePageWhereInput {
    return manager ? {} : { OR: [{ publishedAt: { not: null } }, { authorId: user.id }] };
  }
  async page(user: CurrentUser, spaceId: string, id: string, tx: Prisma.TransactionClient = this.infra.db) {
    const space = await this.space(user, spaceId, tx);
    const page = await tx.knowledgePage.findFirst({ where: { id, spaceId, organizationId: user.organizationId, ...this.pageVisibility(user, space.myRole === 'MANAGER') }, include: { author: { select: personSelect } } });
    if (!page) throw new NotFoundException('Страница не найдена');
    return page;
  }
  async write<T>(user: CurrentUser, id: string, fn: (tx: Prisma.TransactionClient, space: Awaited<ReturnType<KnowledgeService['space']>>) => Promise<T>, manager = false, archived = false): Promise<T> {
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
      const space = await this.space(user, id, tx);
      if (space.myRole === 'VIEWER' || (manager && space.myRole !== 'MANAGER')) throw new ForbiddenException();
      if (space.archived && !archived) throw new ConflictException('Пространство в архиве');
      return fn(tx, space);
    });
  }
  async spaces(user: CurrentUser, query: { archived: string; offset: number; limit: number }) {
    const where = { ...this.visibility(user), archived: query.archived === 'true' };
    const [items, total] = await this.infra.db.$transaction([this.infra.db.knowledgeSpace.findMany({ where, orderBy: { createdAt: 'desc' }, skip: query.offset, take: query.limit, include: { _count: { select: { members: true, pages: true } } } }), this.infra.db.knowledgeSpace.count({ where })]);
    return { items, total, offset: query.offset, limit: query.limit };
  }
  async createSpace(user: CurrentUser, data: { key: string; name: string; description: string }) {
    if (!user.permissions.some(p => ['knowledge:create', 'knowledge:manage'].includes(p))) throw new ForbiddenException();
    return this.infra.db.$transaction(async tx => {
      const space = await tx.knowledgeSpace.create({ data: { ...data, ownerId: user.id, organizationId: user.organizationId } });
      await tx.spaceMember.create({ data: { spaceId: space.id, organizationId: user.organizationId, userId: user.id, role: 'MANAGER' } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `space.created:${space.id}` } });
      return space;
    });
  }
  updateSpace(user: CurrentUser, id: string, data: { version: number; name?: string; description?: string; archived?: boolean }) {
    return this.write(user, id, async (tx, space) => {
      const { version, ...fields } = data;
      if (space.version !== version) throw new ConflictException('Пространство изменено другим сотрудником');
      const updated = await tx.knowledgeSpace.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `space.updated:${id}` } });
      return updated;
    }, true, true);
  }
  member(user: CurrentUser, spaceId: string, data: { userId: string; role: ProjectRole } | { userId: string; remove: true }) {
    return this.write(user, spaceId, async (tx, space) => {
      if (data.userId === space.ownerId) throw new BadRequestException('Владелец должен оставаться администратором');
      if ('remove' in data) await tx.spaceMember.deleteMany({ where: { spaceId, userId: data.userId } });
      else {
        if (space.members.length >= 500 && !space.members.some(m => m.userId === data.userId)) throw new BadRequestException('Лимит 500 участников');
        if (!await tx.user.findFirst({ where: { id: data.userId, organizationId: user.organizationId, active: true } })) throw new NotFoundException();
        await tx.spaceMember.upsert({ where: { spaceId_userId: { spaceId, userId: data.userId } }, create: { spaceId, organizationId: user.organizationId, ...data }, update: { role: data.role } });
      }
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `space.member_changed:${spaceId}:${data.userId}` } });
      return { ok: true };
    }, true);
  }
  async people(user: CurrentUser, spaceId: string, q: string) {
    const space = await this.space(user, spaceId);
    if (space.myRole !== 'MANAGER') throw new ForbiddenException();
    return this.infra.db.user.findMany({ where: { active: true, organizationId: user.organizationId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }, select: personSelect, take: 100, orderBy: { name: 'asc' } });
  }
  async pages(user: CurrentUser, spaceId: string, q: string, archived: boolean) {
    const space = await this.space(user, spaceId);
    return this.infra.db.knowledgePage.findMany({ where: { spaceId, organizationId: user.organizationId, archived, ...this.pageVisibility(user, space.myRole === 'MANAGER'), ...(q ? { AND: [{ OR: [{ title: { contains: q, mode: 'insensitive' } }, { text: { contains: q, mode: 'insensitive' } }] }] } : {}) }, select: pageSummary, orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }], take: 2000 });
  }
  private async parent(user: CurrentUser, spaceId: string, pageId: string | null, parentId: string | null, tx: Prisma.TransactionClient) {
    let current = parentId; const seen = new Set<string>();
    while (current) {
      if (current === pageId || seen.has(current) || seen.size >= 25) throw new BadRequestException('Цикл или слишком глубокое дерево страниц');
      seen.add(current);
      const parent = await this.page(user, spaceId, current, tx);
      if (parent.archived || !parent.publishedAt) throw new BadRequestException('Родитель должен быть опубликован и не находиться в архиве');
      current = parent.parentId;
    }
  }
  createPage(user: CurrentUser, spaceId: string, data: { title: string; parentId: string | null }) {
    return this.write(user, spaceId, async tx => {
      await this.parent(user, spaceId, null, data.parentId, tx);
      if (await tx.knowledgePage.count({ where: { spaceId } }) >= 2000) throw new BadRequestException('Лимит 2000 страниц на пространство');
      return tx.knowledgePage.create({ data: { ...data, organizationId: user.organizationId, spaceId, authorId: user.id }, include: { author: { select: personSelect } } });
    });
  }
  async loadPage(user: CurrentUser, spaceId: string, id: string) {
    const page = await this.page(user, spaceId, id);
    const draft = await this.infra.db.pageDraft.findUnique({ where: { pageId_userId: { pageId: id, userId: user.id } } });
    return { ...page, draft };
  }
  save(user: CurrentUser, spaceId: string, id: string, data: { title: string; content: RichNode; baseRevision: number }, publish: boolean) {
    return this.write(user, spaceId, async tx => {
      const previous = await this.page(user, spaceId, id, tx);
      if (previous.archived) throw new ConflictException('Страница в архиве');
      if (!publish) return tx.pageDraft.upsert({ where: { pageId_userId: { pageId: id, userId: user.id } }, create: { pageId: id, userId: user.id, organizationId: user.organizationId, title: data.title, content: data.content as unknown as Prisma.InputJsonValue, baseRevision: data.baseRevision }, update: { title: data.title, content: data.content as unknown as Prisma.InputJsonValue, baseRevision: data.baseRevision } });
      if (previous.revision !== data.baseRevision) throw new ConflictException('Есть новая версия страницы. Ваш личный черновик сохранён; сравните версии перед публикацией.');
      const page = await tx.knowledgePage.update({ where: { id }, data: { title: data.title, content: data.content as unknown as Prisma.InputJsonValue, text: documentText(data.content), revision: { increment: 1 }, publishedAt: new Date() }, include: { author: { select: personSelect } } });
      await tx.pageRevision.create({ data: { pageId: id, organizationId: user.organizationId, number: page.revision, title: page.title, content: page.content as Prisma.InputJsonValue, authorId: user.id } });
      await tx.pageDraft.deleteMany({ where: { pageId: id, userId: user.id } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `page.published:${id}:${page.revision}` } });
      await pageNotifications(tx, user, page, `page:${id}:${page.revision}`, 'опубликовал страницу');
      return page;
    });
  }
  move(user: CurrentUser, spaceId: string, id: string, data: { revision: number; parentId?: string | null; archived?: boolean; sortOrder?: number }) {
    return this.write(user, spaceId, async tx => {
      const page = await this.page(user, spaceId, id, tx);
      if (page.revision !== data.revision) throw new ConflictException();
      if (data.parentId !== undefined) await this.parent(user, spaceId, id, data.parentId, tx);
      if (data.archived && await tx.knowledgePage.count({ where: { parentId: id, archived: false } })) throw new ConflictException('Сначала архивируйте дочерние страницы');
      const { revision: _, ...fields } = data; void _;
      const result = await tx.knowledgePage.update({ where: { id }, data: { ...fields, revision: { increment: 1 } } });
      if (result.publishedAt) await tx.pageRevision.create({ data: { pageId: id, organizationId: user.organizationId, number: result.revision, title: result.title, content: result.content as Prisma.InputJsonValue, authorId: user.id } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `page.moved_or_archived:${id}` } });
      return result;
    });
  }
  async versions(user: CurrentUser, spaceId: string, id: string, offset: number) {
    await this.page(user, spaceId, id);
    return this.infra.db.pageRevision.findMany({ where: { pageId: id }, include: { author: { select: personSelect } }, orderBy: { number: 'desc' }, skip: offset, take: 50 });
  }
  async restore(user: CurrentUser, spaceId: string, id: string, number: number, revision: number) {
    await this.page(user, spaceId, id);
    const old = await this.infra.db.pageRevision.findUnique({ where: { pageId_number: { pageId: id, number } } });
    if (!old) throw new NotFoundException();
    return this.save(user, spaceId, id, { title: old.title, content: old.content as unknown as RichNode, baseRevision: revision }, true);
  }
  async comments(user: CurrentUser, spaceId: string, id: string, offset: number) {
    await this.page(user, spaceId, id);
    return this.infra.db.pageComment.findMany({ where: { pageId: id }, include: { author: { select: personSelect } }, orderBy: { createdAt: 'desc' }, skip: offset, take: 50 });
  }
  comment(user: CurrentUser, spaceId: string, id: string, body: string) {
    return this.write(user, spaceId, async tx => {
      const page = await this.page(user, spaceId, id, tx);
      if (page.archived || !page.publishedAt) throw new ConflictException('Комментарии доступны для опубликованной страницы');
      const result = await tx.pageComment.create({ data: { pageId: id, organizationId: user.organizationId, authorId: user.id, body }, include: { author: { select: personSelect } } });
      await pageNotifications(tx, user, page, `page-comment:${result.id}`, 'прокомментировал страницу');
      return result;
    });
  }
  async linkedTasks(user: CurrentUser, spaceId: string, id: string) {
    await this.page(user, spaceId, id);
    return this.infra.db.pageTaskLink.findMany({ where: { pageId: id, task: { project: this.projects.visibility(user) } }, include: { task: { select: { id: true, projectId: true, number: true, title: true, status: true, project: { select: { key: true } } } } } });
  }
  taskFromPage(user: CurrentUser, spaceId: string, id: string, data: { projectId: string; title: string }) {
    return this.write(user, spaceId, async tx => {
      await this.page(user, spaceId, id, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.projectId}))`;
      const project = await this.projects.load(user, data.projectId, tx);
      if (project.myRole === 'VIEWER' || project.archived) throw new ForbiddenException('Нет права создавать задачи в выбранном проекте');
      const workflow = (project.workflow as unknown as Workflow | null) ?? defaultWorkflow;
      const limit = workflow.statuses.find(s => s.key === 'NEW')?.wipLimit;
      if (limit && await tx.task.count({ where: { projectId: project.id, status: 'NEW' } }) >= limit) throw new ConflictException('Достигнут WIP-лимит');
      const next = await tx.project.update({ where: { id: project.id }, data: { nextTaskNumber: { increment: 1 } } });
      const task = await tx.task.create({ data: { projectId: project.id, organizationId: user.organizationId, authorId: user.id, number: next.nextTaskNumber, title: data.title } });
      await tx.pageTaskLink.create({ data: { taskId: task.id, pageId: id, organizationId: user.organizationId } });
      await tx.taskEvent.create({ data: { taskId: task.id, organizationId: user.organizationId, actorId: user.id, action: 'task.created', changes: {} } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `page.task_created:${id}:${task.id}` } });
      return task;
    });
  }
}
