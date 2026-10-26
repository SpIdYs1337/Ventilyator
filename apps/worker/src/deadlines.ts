import type { PrismaClient } from '@ventilyator/database';
export async function startDeadlines(db: PrismaClient) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const tasks = await db.$queryRaw<{ id: string; organizationId: string; projectId: string; assigneeId: string; title: string; dueAt: Date; phase: string }[]>`
        SELECT t.id,t."organizationId",t."projectId",t."assigneeId",t.title,t."dueAt", CASE WHEN t."dueAt"<CURRENT_TIMESTAMP THEN 'overdue' ELSE 'soon' END AS phase
        FROM "Task" t JOIN "User" u ON u.id=t."assigneeId" JOIN "Project" p ON p.id=t."projectId"
        WHERE u.active=true AND p.archived=false AND t."completedAt" IS NULL AND t."dueAt" <= CURRENT_TIMESTAMP + INTERVAL '24 hours'
        AND EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=u.id AND m.role<>'VIEWER')
        AND NOT EXISTS(SELECT 1 FROM "Notification" n WHERE n."userId"=u.id AND n."eventKey"='deadline-' || CASE WHEN t."dueAt"<CURRENT_TIMESTAMP THEN 'overdue' ELSE 'soon' END || ':' || t.id || ':' || ((EXTRACT(EPOCH FROM t."dueAt")*1000)::bigint)::text)
        ORDER BY t."dueAt" ASC LIMIT 200`;
      for (const task of tasks) {
        const preferences = await db.userPreferences.findUnique({ where: { userId: task.assigneeId } });
        const eventKey = `deadline-${task.phase}:${task.id}:${task.dueAt.getTime()}`;
        await db.notification.upsert({ where: { userId_eventKey: { userId: task.assigneeId, eventKey } }, update: {}, create: { organizationId: task.organizationId, userId: task.assigneeId, taskId: task.id, eventKey, title: `${task.phase === 'overdue' ? 'Просрочена задача' : 'Срок задачи в ближайшие 24 часа'} «${task.title}»`, href: `/projects/${task.projectId}/tasks/${task.id}`, ...(preferences?.emailEnabled ? { email: { create: {} } } : {}) } });
      }
    } catch { console.error('Ventilyator deadline scheduler failed'); }
    finally { running = false; }
  };
  await tick(); const timer = setInterval(() => { void tick(); }, 60000);
  return { close: () => { clearInterval(timer); } };
}
