import { z } from 'zod';
const statuses = ['NEW', 'PLANNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'] as const;
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
  assigneeId: z.uuid().nullable(), dueAt: z.iso.datetime({ offset: true }).nullable(),
};
export const createTaskSchema = z.object(taskFields).partial().required({ title: true }).strict();
export const updateTaskSchema = z.object({ ...taskFields, status: z.enum(statuses) }).partial().extend({ version: z.number().int().positive() }).strict().refine(v => Object.keys(v).length > 1);
export const taskListSchema = pageSchema.extend({ status: z.enum(statuses).optional(), q: z.string().trim().max(200).optional(), mine: z.enum(['true', 'false']).default('false') }).strict();
export const commentSchema = z.object({ body: z.string().trim().min(1).max(10000) }).strict();
export const peopleSchema = pageSchema.extend({ q: z.string().trim().max(200).default('') }).strict();
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListInput = z.infer<typeof taskListSchema>;
