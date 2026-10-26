import { z } from 'zod';
const priorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const types = ['TASK', 'BUG', 'IMPROVEMENT', 'REQUEST', 'INCIDENT', 'EPIC', 'SUBTASK'] as const;
export const pageSchema = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const projectListSchema = pageSchema.extend({ archived: z.enum(['true', 'false']).default('false') }).strict();
export const createProjectSchema = z.object({ key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,11}$/), name: z.string().trim().min(1).max(150), description: z.string().max(20000).default('') }).strict();
export const updateProjectSchema = z.object({ version: z.number().int().positive(), name: z.string().trim().min(1).max(150).optional(), description: z.string().max(20000).optional(), archived: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 1);
export const memberSchema = z.object({ userId: z.uuid(), role: z.enum(['MANAGER', 'MEMBER', 'VIEWER']) }).strict();
const taskFields = {
  title: z.string().trim().min(1).max(250), description: z.string().max(50000),
  type: z.enum(types), priority: z.enum(priorities),
  assigneeId: z.uuid().nullable(), dueAt: z.iso.datetime({ offset: true }).nullable(), startsAt: z.iso.datetime({ offset: true }).nullable(),
  parentId: z.uuid().nullable(), sprintId: z.uuid().nullable(), labels: z.array(z.string().trim().min(1).max(50)).max(30),
  estimateMinutes: z.number().int().min(0).max(1000000), storyPoints: z.number().int().min(0).max(1000).nullable(),
};
export const createTaskSchema = z.object(taskFields).partial().required({ title: true }).strict();
export const updateTaskSchema = z.object({ ...taskFields, status: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/) }).partial().extend({ version: z.number().int().positive() }).strict().refine(v => Object.keys(v).length > 1);
export const taskListSchema = pageSchema.extend({ status: z.string().max(40).optional(), sprintId: z.union([z.uuid(), z.literal('backlog')]).optional(), q: z.string().trim().max(200).optional(), mine: z.enum(['true', 'false']).default('false') }).strict();
export const commentSchema = z.object({ body: z.string().trim().min(1).max(10000) }).strict();
export const peopleSchema = pageSchema.extend({ q: z.string().trim().max(200).default('') }).strict();
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListInput = z.infer<typeof taskListSchema>;
export const sprintSchema = z.object({ name: z.string().trim().min(1).max(150), goal: z.string().max(5000).default(''), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }) }).strict().refine(v => new Date(v.endsAt) > new Date(v.startsAt));
export const sprintStateSchema = z.object({ status: z.enum(['ACTIVE', 'CLOSED']) }).strict();
export const checklistSchema = z.object({ label: z.string().trim().min(1).max(500), done: z.boolean().default(false) }).strict();
export const doneSchema = z.object({ done: z.boolean() }).strict();
export const dependencySchema = z.object({ dependsOnId: z.uuid() }).strict();
export const timeSchema = z.object({ minutes: z.number().int().min(1).max(1440), note: z.string().max(2000).default(''), startedAt: z.iso.datetime({ offset: true }) }).strict();
export const watchSchema = z.object({ enabled: z.boolean() }).strict();
export const linkPageSchema = z.object({ pageId: z.uuid() }).strict();
