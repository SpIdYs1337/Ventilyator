import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@ventilyator/database';
import type { CurrentUser } from '@ventilyator/shared';
import { Infrastructure } from '../infrastructure';
import { ProjectsService, personSelect } from '../work/projects.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Injectable()
export class PortalService {
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure, @Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}
  private notices(user: CurrentUser): Prisma.NotificationWhereInput {
    return { userId: user.id, organizationId: user.organizationId, OR: [{ task: { project: this.projects.visibility(user) } }, { page: { space: this.knowledge.visibility(user), OR: [{ publishedAt: { not: null } }, { authorId: user.id }] } }, { taskId: null, pageId: null }] };
  }
  async dashboard(user: CurrentUser) {
    const assigned: Prisma.TaskWhereInput = { organizationId: user.organizationId, assigneeId: user.id, project: { ...this.projects.visibility(user), archived: false } };
    const now = new Date(); const week = new Date(Date.now() + 7 * 86400000);
    const [tasks, overdue, upcoming, completed, projects, spaces, recentPages, unread, preferences, activity] = await Promise.all([
      this.infra.db.task.findMany({ where: { ...assigned, completedAt: null }, include: { project: { select: { key: true, name: true } } }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }], take: 20 }),
      this.infra.db.task.count({ where: { ...assigned, completedAt: null, dueAt: { lt: now } } }),
      this.infra.db.task.count({ where: { ...assigned, completedAt: null, dueAt: { gte: now, lte: week } } }),
      this.infra.db.task.count({ where: { ...assigned, completedAt: { not: null } } }),
      this.infra.db.project.count({ where: { ...this.projects.visibility(user), archived: false } }),
      this.infra.db.knowledgeSpace.count({ where: { ...this.knowledge.visibility(user), archived: false } }),
      this.infra.db.knowledgePage.findMany({ where: { archived: false, space: this.knowledge.visibility(user), OR: [{ publishedAt: { not: null } }, { authorId: user.id }] }, select: { id: true, spaceId: true, title: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 8 }),
      this.infra.db.notification.count({ where: { ...this.notices(user), readAt: null } }),
      this.infra.db.userPreferences.findUnique({ where: { userId: user.id } }),
      this.infra.db.taskEvent.findMany({ where: { organizationId: user.organizationId, task: { project: this.projects.visibility(user) } }, include: { actor: { select: personSelect }, task: { select: { id: true, title: true, projectId: true, number: true, project: { select: { key: true } } } } }, orderBy: { createdAt: 'desc' }, take: 12 }),
    ]);
    return { tasks, overdue, upcoming, completed, projects, spaces, recentPages, unread, preferences, activity };
  }
  async notifications(user: CurrentUser, offset: number, unread: boolean) {
    const where = { ...this.notices(user), ...(unread ? { readAt: null } : {}) };
    const [items, total, unreadCount] = await this.infra.db.$transaction([this.infra.db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: 50 }), this.infra.db.notification.count({ where }), this.infra.db.notification.count({ where: { ...this.notices(user), readAt: null } })]);
    return { items, total, unreadCount, offset, limit: 50 };
  }
  async read(user: CurrentUser, id?: string) {
    await this.infra.db.notification.updateMany({ where: { ...this.notices(user), ...(id ? { id } : {}), readAt: null }, data: { readAt: new Date() } }); return { ok: true };
  }
  preferences(user: CurrentUser, data: { emailEnabled?: boolean; widgets?: string[] }) {
    return this.infra.db.userPreferences.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  }
  async search(user: CurrentUser, query: string) {
    const q = query.trim(); if (!q) return [];
    const manageProjects = user.permissions.includes('projects:manage'), manageKnowledge = user.permissions.includes('knowledge:manage');
    // Parameterized FTS/trigram queries include ACL predicates before LIMIT, including private drafts.
    return this.infra.db.$queryRaw<{ kind: string; id: string; title: string; href: string; subtitle: string }[]>(Prisma.sql`
      SELECT * FROM (
        SELECT 'task' AS kind, t.id::text AS id, t.title, '/projects/' || p.id || '/tasks/' || t.id AS href, p.key || '-' || t.number AS subtitle, t."updatedAt" AS changed
        FROM "Task" t JOIN "Project" p ON p.id=t."projectId"
        WHERE p."organizationId"=${user.organizationId}::uuid AND (${manageProjects} OR p."ownerId"=${user.id}::uuid OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=${user.id}::uuid))
        AND (to_tsvector('russian', t.title || ' ' || t.description) @@ websearch_to_tsquery('russian',${q}) OR to_tsvector('simple', t.title || ' ' || t.description) @@ websearch_to_tsquery('simple',${q}) OR t.title ILIKE ${'%' + q + '%'} OR p.key || '-' || t.number = ${q.toUpperCase()})
        UNION ALL
        SELECT 'page', d.id::text, d.title, '/knowledge/' || s.id || '/pages/' || d.id, s.name, d."updatedAt"
        FROM "KnowledgePage" d JOIN "KnowledgeSpace" s ON s.id=d."spaceId"
        WHERE s."organizationId"=${user.organizationId}::uuid AND (${manageKnowledge} OR s."ownerId"=${user.id}::uuid OR EXISTS(SELECT 1 FROM "SpaceMember" m WHERE m."spaceId"=s.id AND m."userId"=${user.id}::uuid))
        AND (d."publishedAt" IS NOT NULL OR d."authorId"=${user.id}::uuid OR ${manageKnowledge}) AND d.archived=false
        AND (to_tsvector('russian', d.title || ' ' || d.text) @@ websearch_to_tsquery('russian',${q}) OR to_tsvector('simple', d.title || ' ' || d.text) @@ websearch_to_tsquery('simple',${q}) OR d.title ILIKE ${'%' + q + '%'})
        UNION ALL
        SELECT 'project', p.id::text, p.name, '/projects/' || p.id, p.key, p."updatedAt"
        FROM "Project" p WHERE p."organizationId"=${user.organizationId}::uuid AND (${manageProjects} OR p."ownerId"=${user.id}::uuid OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=${user.id}::uuid)) AND (p.name ILIKE ${'%' + q + '%'} OR p.key ILIKE ${'%' + q + '%'})
      ) results ORDER BY changed DESC LIMIT 50`);
  }
  async reports(user: CurrentUser, projectId: string) {
    await this.projects.load(user, projectId);
    const tasks = await this.infra.db.task.findMany({ where: { projectId, organizationId: user.organizationId }, select: { id: true, projectId: true, number: true, title: true, type: true, status: true, priority: true, version: true, assignee: { select: personSelect }, dueAt: true, startsAt: true, completedAt: true, estimateMinutes: true, storyPoints: true, parentId: true, sprintId: true, labels: true, createdAt: true, updatedAt: true }, orderBy: { number: 'asc' }, take: 10000 });
    const time = await this.infra.db.timeEntry.groupBy({ by: ['taskId'], where: { organizationId: user.organizationId, task: { projectId } }, _sum: { minutes: true } });
    const spent = new Map(time.map(row => [row.taskId, row._sum.minutes ?? 0]));
    const status = await this.infra.db.task.groupBy({ by: ['status'], where: { projectId }, _count: true });
    return { tasks: tasks.map(t => ({ ...t, spentMinutes: spent.get(t.id) ?? 0 })), status, truncated: status.reduce((n, s) => n + s._count, 0) > tasks.length };
  }
}
