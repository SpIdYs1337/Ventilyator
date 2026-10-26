import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ventilyator/ui';
import { taskStatuses, type Page, type ProjectDetail, type TaskComment, type TaskEvent, type TaskSummary } from '@ventilyator/shared';
import { api } from '../lib/api';
import { ErrorMessage, Loading } from '../components/common';
import { Modal, Pagination, priorityLabels, statusLabels, TaskForm, typeLabels } from '../components/work';
import { TaskExtras } from './TaskExtras';

export function Task() {
  const { projectId = '', taskId = '' } = useParams();
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api<ProjectDetail>(`/projects/${projectId}`), refetchInterval: 10000 });
  const task = useQuery({ queryKey: ['task', projectId, taskId], queryFn: () => api<TaskSummary>(`/projects/${projectId}/tasks/${taskId}`), refetchInterval: 10000 });
  if (project.isLoading || task.isLoading) return <Loading />;
  if (!project.data || !task.data || project.isError || task.isError) return <ErrorMessage error={project.error ?? task.error} />;
  return <TaskContent key={taskId} task={task.data} project={project.data} />;
}

function TaskContent({ task, project }: { task: TaskSummary; project: ProjectDetail }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'comments' | 'events'>('comments');
  const [offset, setOffset] = useState(0);
  const [body, setBody] = useState('');
  const client = useQueryClient();
  const base = `/projects/${project.id}/tasks/${task.id}`;
  const canEdit = project.myRole !== 'VIEWER' && !project.archived;
  const statuses = project.workflow?.statuses.map(s => s.key) ?? taskStatuses;
  const statusNames = { ...statusLabels, ...Object.fromEntries(project.workflow?.statuses.map(s => [s.key, s.name]) ?? []) };
  const comments = useQuery({ queryKey: ['task-comments', task.id, offset], queryFn: () => api<Page<TaskComment>>(`${base}/comments?offset=${offset}`), enabled: tab === 'comments', refetchInterval: 10000 });
  const events = useQuery({ queryKey: ['task-events', task.id, offset], queryFn: () => api<Page<TaskEvent>>(`${base}/events?offset=${offset}`), enabled: tab === 'events', refetchInterval: 10000 });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['task', project.id, task.id] }); void client.invalidateQueries({ queryKey: ['tasks', project.id] }); void client.invalidateQueries({ queryKey: ['task-events', task.id] }); };
  const update = useMutation({ mutationFn: (data: Record<string, unknown>) => api(base, { method: 'PATCH', body: JSON.stringify(data) }), onSuccess: () => { setOpen(false); refresh(); }, onError: refresh });
  const comment = useMutation({ mutationFn: () => api(`${base}/comments`, { method: 'POST', body: JSON.stringify({ body }) }), onSuccess: () => { setBody(''); setOffset(0); void client.invalidateQueries({ queryKey: ['task-comments', task.id] }); } });
  const activity = tab === 'comments' ? comments : events;
  return <><Link className="back-link" to={`/projects/${project.id}`}>← {project.name}</Link><div className="page-heading"><div><span className="eyebrow">{project.key}-{task.number}</span><h1>{task.title}</h1><p>Создал {task.author.name} · {new Date(task.createdAt).toLocaleString('ru-RU')}</p></div>{canEdit && <Button onClick={() => { update.reset(); setOpen(true); }}>Редактировать задачу</Button>}</div>{update.isError && !open && <ErrorMessage error={update.error} />}<div className="task-layout"><section className="panel info-panel"><h2>Описание</h2><p className="preserve-lines">{task.description || 'Описание не добавлено'}</p></section><section className="panel info-panel task-properties"><label>Статус<select aria-label="Статус задачи" value={task.status} disabled={!canEdit || update.isPending} onChange={e => update.mutate({ status: e.target.value, version: task.version })}>{statuses.map(s => <option key={s} value={s}>{statusNames[s]}</option>)}</select></label><p>Тип: {typeLabels[task.type]}</p><p>Приоритет: {priorityLabels[task.priority]}</p><p>Исполнитель: {task.assignee?.name ?? 'Не назначен'}</p><p>Срок: {task.dueAt ? new Date(task.dueAt).toLocaleDateString('ru-RU') : 'Не задан'}</p>{task.completedAt && <p>Выполнена: {new Date(task.completedAt).toLocaleString('ru-RU')}</p>}</section></div><TaskExtras task={task} project={project} /><div className="tabs" role="tablist">{(['comments', 'events'] as const).map(id => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setOffset(0); }}>{id === 'comments' ? 'Комментарии' : 'История изменений'}</button>)}</div>{activity.isLoading && <Loading />}{activity.isError && <ErrorMessage error={activity.error} />}{tab === 'comments' && <>{canEdit && <form className="comment-form" onSubmit={e => { e.preventDefault(); comment.mutate(); }}><label>Комментарий<textarea required maxLength={10000} rows={3} value={body} onChange={e => setBody(e.target.value)} /></label>{comment.isError && <ErrorMessage error={comment.error} />}<Button type="submit" disabled={comment.isPending || !body.trim()}>Отправить комментарий</Button></form>}{comments.data?.items.map(c => <article className="panel activity-entry" key={c.id}><strong>{c.author.name}</strong><time>{new Date(c.createdAt).toLocaleString('ru-RU')}</time><p className="preserve-lines">{c.body}</p></article>)}</>}{tab === 'events' && events.data?.items.map(e => <article className="panel activity-entry" key={e.id}><strong>{e.actor.name}</strong><time>{new Date(e.createdAt).toLocaleString('ru-RU')}</time><p>{e.action === 'task.created' ? 'Создал задачу' : 'Изменил задачу'}</p>{Object.entries(e.changes).map(([key, values]) => <p key={key}><strong>{({ title: 'Название', description: 'Описание', status: 'Статус', priority: 'Приоритет', type: 'Тип', assigneeId: 'Исполнитель (ID)', dueAt: 'Срок' } as Record<string, string>)[key] ?? key}:</strong> {display(values.before)} → {display(values.after)}</p>)}</article>)}{activity.data && <Pagination offset={offset} total={activity.data.total} change={setOffset} />}{open && <Modal title="Редактирование задачи" description={`${project.key}-${task.number} · изменения защищены от одновременной перезаписи.`} close={() => setOpen(false)}><TaskForm project={project} task={task} pending={update.isPending} submit={data => update.mutate(data)} error={update.isError && <ErrorMessage error={update.error} />} /></Modal>}</>;
}

function display(value: unknown) {
  if (value === null || value === '') return 'Не задано';
  const labels: Record<string, string> = { ...statusLabels, ...priorityLabels, ...typeLabels };
  return typeof value === 'string' ? labels[value] ?? value : JSON.stringify(value);
}
