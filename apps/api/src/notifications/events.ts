import type { Prisma } from '@ventilyator/database';
import type { CurrentUser } from '@ventilyator/shared';

export async function taskNotifications(tx: Prisma.TransactionClient, actor: CurrentUser, task: { id: string; projectId: string; title: string; authorId: string; assigneeId: string | null }, eventKey: string, verb: string) {
  const watchers = await tx.taskWatch.findMany({ where: { taskId: task.id }, select: { userId: true } });
  const ids = [...new Set([task.authorId, task.assigneeId, ...watchers.map(w => w.userId)].filter((id): id is string => Boolean(id) && id !== actor.id))];
  if (!ids.length) return;
  const users = await tx.user.findMany({ where: { id: { in: ids }, active: true, organizationId: actor.organizationId, projectMemberships: { some: { projectId: task.projectId } } }, include: { preferences: true } });
  for (const user of users) await tx.notification.upsert({ where: { userId_eventKey: { userId: user.id, eventKey } }, update: {}, create: { organizationId: actor.organizationId, userId: user.id, taskId: task.id, eventKey, title: `${actor.name}: ${verb} «${task.title}»`, href: `/projects/${task.projectId}/tasks/${task.id}`, ...(user.preferences?.emailEnabled ? { email: { create: {} } } : {}) } });
}

export async function pageNotifications(tx: Prisma.TransactionClient, actor: CurrentUser, page: { id: string; spaceId: string; title: string }, eventKey: string, verb: string, mentions: string[] = []) {
  const users = await tx.user.findMany({ where: { id: { not: actor.id }, active: true, organizationId: actor.organizationId, OR: [{ spaceMemberships: { some: { spaceId: page.spaceId } } }, { id: { in: mentions }, roles: { some: { role: { permissions: { some: { permission: 'knowledge:manage' } } } } } }] }, include: { preferences: true }, take: 500 });
  for (const user of users) await tx.notification.upsert({ where: { userId_eventKey: { userId: user.id, eventKey } }, update: {}, create: { organizationId: actor.organizationId, userId: user.id, pageId: page.id, eventKey, title: `${actor.name}: ${mentions.includes(user.id) ? 'упомянул(а) вас на странице' : verb} «${page.title}»`, href: `/knowledge/${page.spaceId}/pages/${page.id}`, ...(user.preferences?.emailEnabled ? { email: { create: {} } } : {}) } });
}
