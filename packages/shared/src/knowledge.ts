export interface RichNode { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: RichNode[] }
export interface RichDocument extends RichNode { type: 'doc'; content: RichNode[] }
export const emptyDocument: RichDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
export function documentText(node: RichNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(documentText).join(['doc', 'bulletList', 'orderedList', 'taskList', 'table', 'tableRow'].includes(node.type) ? '\n' : '') + (['paragraph', 'heading', 'codeBlock'].includes(node.type) ? '\n' : '');
}
export interface SpaceSummary { id: string; key: string; name: string; description: string; archived: boolean; version: number; ownerId: string; _count: { pages: number; members: number } }
export interface SpaceDetail extends SpaceSummary { myRole: 'MANAGER' | 'MEMBER' | 'VIEWER'; members: { userId: string; role: string; user: { id: string; name: string; email: string; active: boolean } }[] }
export interface PageSummary { id: string; spaceId: string; parentId: string | null; title: string; revision: number; archived: boolean; publishedAt: string | null; updatedAt: string; author: { id: string; name: string } }
export interface KnowledgePage extends PageSummary { content: RichDocument; text: string; draft: { title: string; content: RichDocument; baseRevision: number; updatedAt: string } | null }
export interface PageRevision { id: string; number: number; title: string; content: RichDocument; author: { name: string }; createdAt: string }
export interface Workflow { statuses: { key: string; name: string; done: boolean; wipLimit?: number }[]; transitions: { from: string; to: string; managerOnly: boolean }[] }
export const defaultWorkflow: Workflow = { statuses: [
  { key: 'NEW', name: 'Новая', done: false }, { key: 'PLANNED', name: 'Запланирована', done: false },
  { key: 'IN_PROGRESS', name: 'В работе', done: false }, { key: 'REVIEW', name: 'На проверке', done: false },
  { key: 'DONE', name: 'Выполнена', done: true }, { key: 'CLOSED', name: 'Закрыта', done: true },
], transitions: [] };
export interface Sprint { id: string; name: string; goal: string; status: 'PLANNED' | 'ACTIVE' | 'CLOSED'; startsAt: string; endsAt: string; result: { total: number; completed: number; points: number; completedPoints: number } | null; _count: { tasks: number } }
export interface FileObject { id: string; name: string; state: string; createdAt: string; versions: { number: number; size: number; sha256: string; mimeType: string }[] }
export interface NotificationItem { id: string; title: string; href: string; readAt: string | null; createdAt: string }
