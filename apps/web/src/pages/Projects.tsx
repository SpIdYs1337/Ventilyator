import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, FolderKanban, Plus } from 'lucide-react';
import { Button } from '@ventilyator/ui';
import type { CurrentUser, Page, ProjectSummary } from '@ventilyator/shared';
import { api } from '../lib/api';
import { Empty, ErrorMessage, Loading } from '../components/common';
import { Modal, Pagination } from '../components/work';

export function Projects({ user }: { user: CurrentUser }) {
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ['projects', archived, offset], queryFn: () => api<Page<ProjectSummary>>(`/projects?archived=${archived}&offset=${offset}`), refetchInterval: 10000 });
  const create = useMutation({ mutationFn: (data: Record<string, FormDataEntryValue>) => api('/projects', { method: 'POST', body: JSON.stringify(data) }), onSuccess: () => { setOpen(false); setOffset(0); setArchived(false); void client.invalidateQueries({ queryKey: ['projects'] }); } });
  return <><div className="page-heading"><div><span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Проекты</h1><p>Здравствуйте, {user.name}. Здесь проекты, к которым у вас есть доступ.</p></div>{user.permissions.some(p => ['projects:create', 'projects:manage'].includes(p)) && <Button onClick={() => { create.reset(); setOpen(true); }}><Plus size={16} />Создать проект</Button>}</div><div className="work-toolbar"><label className="checkbox"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setOffset(0); }} />Показать архив</label><span className="muted">Обновление каждые 10 секунд</span></div>{projects.isLoading && <Loading />}{projects.isError && <ErrorMessage error={projects.error} />}{projects.data && <><div className="feature-grid">{projects.data.items.map(p => <Link to={`/projects/${p.id}`} className="panel feature" key={p.id}><FolderKanban size={24} /><span className="project-key">{p.key}{p.archived ? ' · Архив' : ''}</span><h3>{p.name}</h3><p className="clamp-lines">{p.description || 'Описание пока не добавлено'}</p><p>{p._count.tasks} задач · {p._count.members} участников</p><span>Открыть проект <ArrowUpRight size={14} /></span></Link>)}</div>{!projects.data.total && <Empty title={archived ? 'Архив пуст' : 'Нет доступных проектов'} description="Администратор может создать проект и добавить сотрудников. Участники увидят здесь свои проекты." />}<Pagination offset={offset} total={projects.data.total} change={setOffset} /></>}{open && <Modal title="Новый проект" description="Ключ проекта используется в номерах задач, например VNT-1. После создания ключ не меняется." close={() => setOpen(false)}><form onSubmit={e => { e.preventDefault(); create.mutate(Object.fromEntries(new FormData(e.currentTarget))); }}><label>Название<input name="name" required maxLength={150} /></label><label>Ключ<input name="key" required minLength={2} maxLength={12} pattern="[A-Za-z][A-Za-z0-9]{1,11}" placeholder="VNT" /></label><label>Описание<textarea name="description" rows={4} maxLength={20000} /></label>{create.isError && <ErrorMessage error={create.error} />}<Button disabled={create.isPending} type="submit">Создать проект</Button></form></Modal>}</>;
}
