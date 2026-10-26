export const taskStatuses = ['NEW', 'PLANNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'] as const;
export type TaskStatus = string;
export const taskPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const taskTypes = ['TASK', 'BUG', 'IMPROVEMENT', 'REQUEST', 'INCIDENT', 'EPIC', 'SUBTASK'] as const;
export const projectRoles = ['MANAGER', 'MEMBER', 'VIEWER'] as const;
export type ProjectRole = typeof projectRoles[number];
export interface Person { id: string; name: string; email: string; active?: boolean }
export interface ProjectSummary {
  id: string; key: string; name: string; description: string; archived: boolean; version: number;
  owner: Person; createdAt: string; updatedAt: string; _count: { tasks: number; members: number };
  workflow?: import('./knowledge').Workflow | null; myRole?: ProjectRole;
}
export interface ProjectDetail extends ProjectSummary {
  myRole: ProjectRole; members: { userId: string; role: ProjectRole; user: Person }[];
}
export interface TaskSummary {
  id: string; projectId: string; number: number; title: string; description: string;
  type: typeof taskTypes[number]; status: TaskStatus; priority: typeof taskPriorities[number];
  author: Person; assignee: Person | null; dueAt: string | null; completedAt: string | null;
  version: number; createdAt: string; updatedAt: string;
  startsAt?: string | null; parentId?: string | null; sprintId?: string | null; labels?: string[]; estimateMinutes?: number; storyPoints?: number | null;
}
export interface TaskComment { id: string; body: string; author: Person; createdAt: string }
export interface TaskEvent { id: string; actor: Person; action: string; changes: Record<string, { before: unknown; after: unknown }>; createdAt: string }
export interface Page<T> { items: T[]; total: number; offset: number; limit: number }
