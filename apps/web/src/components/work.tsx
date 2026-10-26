import { useState, type FormEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@ventilyator/ui';
import { taskPriorities, taskTypes, type ProjectDetail, type TaskSummary } from '@ventilyator/shared';
export const statusLabels: Record<string, string> = { NEW: 'Новая', PLANNED: 'Запланирована', IN_PROGRESS: 'В работе', REVIEW: 'На проверке', DONE: 'Выполнена', CLOSED: 'Закрыта' };
export const priorityLabels = { LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', URGENT: 'Срочный' };
export const typeLabels = { TASK: 'Задача', BUG: 'Ошибка', IMPROVEMENT: 'Улучшение', REQUEST: 'Запрос', INCIDENT: 'Инцидент', EPIC: 'Эпик', SUBTASK: 'Подзадача' };
export const roleLabels = { MANAGER: 'Администратор проекта', MEMBER: 'Участник', VIEWER: 'Наблюдатель' };
export function Modal({ title, description, children, close }: { title: string; description: string; children: ReactNode; close: () => void }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>{children}<Dialog.Close asChild><Button className="modal-close" variant="ghost" aria-label="Закрыть окно">×</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Pagination({ offset, total, limit = 50, change }: { offset: number; total: number; limit?: number; change: (value: number) => void }) {
  return <div className="pagination"><span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} из ${total}` : 'Нет записей'}</span><Button variant="outline" disabled={!offset} onClick={() => change(Math.max(0, offset - limit))}>Назад</Button><Button variant="outline" disabled={offset + limit >= total} onClick={() => change(offset + limit)}>Далее</Button></div>;
}
export function TaskForm({ project, task, pending, submit, error }: { project: ProjectDetail; task?: TaskSummary; pending: boolean; submit: (data: Record<string, unknown>) => void; error: ReactNode }) {
  // Keep the version which was loaded with this edit form. Polling must not silently advance it.
  const [original] = useState(task);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const date = data.dueAt as string;
    submit({ ...data, labels: [...new Set(String(data.labels ?? '').split(',').map(v => v.trim()).filter(Boolean))], estimateMinutes: Number(data.estimateMinutes || 0), storyPoints: data.storyPoints === '' ? null : Number(data.storyPoints), startsAt: data.startsAt ? new Date(`${String(data.startsAt)}T00:00:00`).toISOString() : null, dueAt: date ? new Date(`${date}T23:59:59`).toISOString() : null, assigneeId: data.assigneeId || null, ...(original ? { version: original.version } : {}) });
  }
  return <form onSubmit={save}><label>Название<input name="title" required maxLength={250} defaultValue={original?.title} /></label><label>Описание<textarea name="description" rows={5} maxLength={50000} defaultValue={original?.description} /></label><div className="form-columns"><label>Тип<select aria-label="Тип" name="type" defaultValue={original?.type ?? 'TASK'}>{taskTypes.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></label><label>Приоритет<select aria-label="Приоритет" name="priority" defaultValue={original?.priority ?? 'NORMAL'}>{taskPriorities.map(priority => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label></div><label>Исполнитель<select aria-label="Исполнитель" name="assigneeId" defaultValue={original?.assignee?.id ?? ''}><option value="">Не назначен</option>{project.members.filter(m => m.role !== 'VIEWER' && m.user.active).map(m => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></label><label>Начало<input type="date" name="startsAt" defaultValue={original?.startsAt ? new Date(original.startsAt).toLocaleDateString('en-CA') : ''} /></label><label>Срок<input type="date" name="dueAt" defaultValue={original?.dueAt ? new Date(original.dueAt).toLocaleDateString('en-CA') : ''} /></label><div className="form-columns"><label>Оценка, минуты<input name="estimateMinutes" type="number" min={0} max={1000000} defaultValue={original?.estimateMinutes ?? 0} /></label><label>Story points<input name="storyPoints" type="number" min={0} max={1000} defaultValue={original?.storyPoints ?? ''} /></label></div><label>Метки через запятую<input name="labels" defaultValue={original?.labels?.join(', ')} maxLength={1500} /></label>{error}<Button type="submit" disabled={pending}>{pending ? 'Сохранение…' : original ? 'Сохранить' : 'Создать задачу'}</Button></form>;
}
