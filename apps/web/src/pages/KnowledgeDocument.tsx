import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ventilyator/ui';
import { documentText, type CurrentUser, type KnowledgePage, type PageRevision, type PageSummary, type RichDocument, type SpaceDetail, type Page, type ProjectSummary, type RichNode } from '@ventilyator/shared';
import { validDocument } from '@ventilyator/validation';
import { api } from '../lib/api';
import { ErrorMessage, Loading } from '../components/common';
import { Modal } from '../components/work';
import { RichEditor, downloadText, toMarkdown } from '../components/RichEditor';
import { Attachments } from '../components/Attachments';
import { MentionTextarea, MentionText } from '../components/Mentions';
import { importMarkdown } from '../lib/markdown';

export function KnowledgeDocument({ user, space, pageId, pages }: { user: CurrentUser; space: SpaceDetail; pageId: string; pages: PageSummary[] }) {
  const query = useQuery({ queryKey: ['page', pageId], queryFn: () => api<KnowledgePage>(`/knowledge/spaces/${space.id}/pages/${pageId}`), refetchInterval: 10000 });
  if (query.isLoading) return <Loading />;
  if (!query.data || query.isError) return <ErrorMessage error={query.error} />;
  return <DocumentContent user={user} space={space} page={query.data} pages={pages} />;
}
function DocumentContent({ user, space, page, pages }: { user: CurrentUser; space: SpaceDetail; page: KnowledgePage; pages: PageSummary[] }) {
  const [editing, setEditing] = useState(!page.publishedAt), [versions, setVersions] = useState(false), [preview, setPreview] = useState<PageRevision | null>(null), [comment, setComment] = useState('');
  const navigate = useNavigate();
  const [taskOpen, setTaskOpen] = useState(false);
  const client = useQueryClient(); const base = `/knowledge/spaces/${space.id}/pages/${page.id}`;
  const canEdit = space.myRole !== 'VIEWER' && !space.archived && !page.archived;
  const refresh = () => { void client.invalidateQueries({ queryKey: ['page', page.id] }); void client.invalidateQueries({ queryKey: ['pages', space.id] }); void client.invalidateQueries({ queryKey: ['page-versions', page.id] }); };
  const checklist = useMutation({ mutationFn: ({ index, checked }: { index: number; checked: boolean }) => api<KnowledgePage>(`${base}/checklist`, { method: 'PUT', body: JSON.stringify({ revision: page.revision, index, checked }) }), onSuccess: updated => { client.setQueryData<KnowledgePage>(['page', page.id], previous => previous ? { ...previous, ...updated } : previous); refresh(); }, onError: refresh });
  const linked = useQuery({ queryKey: ['page-linked-tasks', page.id], queryFn: () => api<{ task: { id: string; projectId: string; number: number; title: string; project: { key: string } } }[]>(`${base}/tasks`) });
  const projects = useQuery({ queryKey: ['project-options'], queryFn: () => api<Page<ProjectSummary>>('/projects?limit=100'), enabled: taskOpen });
  const createTask = useMutation({ mutationFn: (data: Record<string, FormDataEntryValue>) => api<{ id: string; projectId: string }>(`${base}/tasks`, { method: 'POST', body: JSON.stringify(data) }), onSuccess: task => { void client.invalidateQueries({ queryKey: ['page-linked-tasks', page.id] }); navigate(`/projects/${task.projectId}/tasks/${task.id}`); } });
  const history = useQuery({ queryKey: ['page-versions', page.id], queryFn: () => api<PageRevision[]>(`${base}/versions`), enabled: versions });
  const comments = useQuery({ queryKey: ['page-comments', page.id], queryFn: () => api<{ id: string; body: string; createdAt: string; author: { name: string } }[]>(`${base}/comments`), refetchInterval: 10000, enabled: Boolean(page.publishedAt) });
  const post = useMutation({ mutationFn: () => api(`${base}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) }), onSuccess: () => { setComment(''); void client.invalidateQueries({ queryKey: ['page-comments', page.id] }); } });
  const move = useMutation({ mutationFn: (fields: Record<string, unknown>) => api(base, { method: 'PATCH', body: JSON.stringify({ ...fields, revision: page.revision }) }), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (number: number) => api(`${base}/restore/${number}`, { method: 'POST', body: JSON.stringify({ revision: page.revision }) }), onSuccess: () => { setPreview(null); setVersions(false); refresh(); } });
  return <article className="document-panel panel"><div className="document-tools"><span className="muted">{page.publishedAt ? `Версия ${page.revision} · ${new Date(page.updatedAt).toLocaleString('ru-RU')}` : 'Личный черновик'}{page.archived ? ' · Архив' : ''}</span><div className="inline-actions">{!editing && canEdit && <Button onClick={() => setEditing(true)}>{page.draft ? 'Продолжить черновик' : 'Редактировать страницу'}</Button>}<Button variant="ghost" onClick={() => setVersions(true)}>История версий</Button>{page.publishedAt && !editing && <><Button variant="ghost" onClick={() => downloadText(`${page.title}.md`, toMarkdown(page.content))}>Markdown</Button><Button variant="ghost" onClick={() => window.print()}>Печать / PDF</Button></>}</div></div>{move.isError && <ErrorMessage error={move.error} />}{checklist.isError && <ErrorMessage error={checklist.error} />}{checklist.isPending && <p role="status">Сохранение отметки…</p>}{editing && canEdit ? <DocumentEdit key={page.id} user={user} page={page} base={base} done={() => { setEditing(false); refresh(); }} /> : <><h1 className="document-title">{page.title}</h1><PageContents content={page.content} prefix={page.id} /><RichEditor key={`${page.id}-${page.revision}`} content={page.content} editable={false} anchorPrefix={page.id} checklistPending={checklist.isPending} onChecklistChange={canEdit ? (index, checked) => checklist.mutate({ index, checked }) : undefined} /><div className="document-meta"><span>Автор: {page.author.name}</span>{space.myRole !== 'VIEWER' && !space.archived && <><label>Расположение<select aria-label="Переместить страницу" value={page.parentId ?? ''} disabled={move.isPending} onChange={e => move.mutate({ parentId: e.target.value || null })}><option value="">Верхний уровень</option>{pages.filter(p => p.id !== page.id && p.publishedAt && !p.archived).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><Button variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ archived: !page.archived })}>{page.archived ? 'Восстановить страницу' : 'Архивировать страницу'}</Button></>}</div></>}{!editing && <Attachments kind="page" id={page.id} canEdit={canEdit} />}<section className="document-task-links"><div className="section-heading"><h2>Связанные задачи</h2>{canEdit && <Button variant="outline" onClick={() => { createTask.reset(); setTaskOpen(true); }}>Создать задачу из страницы</Button>}</div>{linked.isError && <ErrorMessage error={linked.error} />}{linked.data?.map(link => <Link className="related-task" key={link.task.id} to={`/projects/${link.task.projectId}/tasks/${link.task.id}`}>{link.task.project.key}-{link.task.number} · {link.task.title}</Link>)}</section>{taskOpen && <Modal title="Задача из страницы" description="Задача будет доступна участникам выбранного проекта. Текст страницы автоматически не копируется." close={() => setTaskOpen(false)}><form onSubmit={e => { e.preventDefault(); createTask.mutate(Object.fromEntries(new FormData(e.currentTarget))); }}><label>Проект новой задачи<select aria-label="Проект новой задачи" name="projectId" required>{projects.data?.items.filter(p => p.myRole !== 'VIEWER').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Название новой задачи<input name="title" defaultValue={page.title} required maxLength={250} /></label>{projects.isError && <ErrorMessage error={projects.error} />}{createTask.isError && <ErrorMessage error={createTask.error} />}<Button type="submit" disabled={createTask.isPending || !projects.data?.items.some(p => p.myRole !== 'VIEWER')}>Создать связанную задачу</Button></form></Modal>}{page.publishedAt && <section className="document-comments"><h2>Обсуждение</h2>{canEdit && <form onSubmit={e => { e.preventDefault(); post.mutate(); }}><MentionTextarea label="Комментарий к странице" value={comment} onChange={setComment} url={`${base}/mentions`} />{post.isError && <ErrorMessage error={post.error} />}<Button disabled={post.isPending || !comment.trim()} type="submit">Отправить комментарий</Button></form>}{comments.isError && <ErrorMessage error={comments.error} />}{comments.data?.map(c => <article className="activity-entry" key={c.id}><strong>{c.author.name}</strong><time>{new Date(c.createdAt).toLocaleString('ru-RU')}</time><p><MentionText body={c.body} /></p></article>)}</section>}{versions && <Modal title="История страницы" description="Восстановление создаёт новую версию и сохраняет предыдущие публикации." close={() => { setVersions(false); setPreview(null); }}><div className="version-list">{history.isLoading && <Loading />}{history.isError && <ErrorMessage error={history.error} />}{restore.isError && <ErrorMessage error={restore.error} />}{history.data?.map(v => <div className="version-row" key={v.id}><div><strong>Версия {v.number}</strong><p>{v.author.name} · {new Date(v.createdAt).toLocaleString('ru-RU')}</p></div><Button variant="outline" onClick={() => setPreview(v)}>Сравнить</Button><Button disabled={restore.isPending || editing} onClick={() => restore.mutate(v.number)}>Восстановить</Button></div>)}{preview && <div className="version-comparison"><h3>Версия {preview.number} → текущая {page.revision}</h3><pre>{documentText(preview.content)}</pre><pre>{documentText(page.content)}</pre></div>}</div></Modal>}</article>;
}
type Draft = { title: string; content: RichDocument; baseRevision: number };
function DocumentEdit({ user, page, base, done }: { user: CurrentUser; page: KnowledgePage; base: string; done: () => void }) {
  const storageKey = `ventilyator:draft:${user.id}:${page.id}`;
  const [initial] = useState<Draft>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Draft | null; if (saved && typeof saved.title === 'string' && Number.isInteger(saved.baseRevision) && validDocument(saved.content)) return saved; } catch { /* Closed browser storage does not prevent editing. */ }
    return page.draft ?? { title: page.title, content: page.content, baseRevision: page.revision };
  });
  const [title, setTitle] = useState(initial.title), [content, setContent] = useState(initial.content), [baseRevision, setBaseRevision] = useState(initial.baseRevision), [status, setStatus] = useState('Черновик открыт'), [publishing, setPublishing] = useState(false), [error, setError] = useState<unknown>(null), [compare, setCompare] = useState(false);
  const [seed, setSeed] = useState(initial.content), [reset, setReset] = useState(0);
  const [insertImage, setInsertImage] = useState<{ src: string; sequence: number } | undefined>(undefined);
  const queue = useRef(Promise.resolve()); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (publishing) return;
    const data = { title, content, baseRevision };
    try { sessionStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* Server draft remains the primary copy. */ }
    timer.current = setTimeout(() => {
      if (!title.trim()) return;
      setStatus('Сохранение черновика…');
      queue.current = queue.current.catch(() => {}).then(async () => { await api(`${base}/draft`, { method: 'PUT', body: JSON.stringify(data) }); setStatus('Черновик сохранён'); }).catch(err => { setStatus('Есть несохранённые изменения'); setError(err); });
    }, 1200);
    return () => clearTimeout(timer.current);
  }, [title, content, baseRevision, base, storageKey, publishing]);
  async function publish() {
    clearTimeout(timer.current); setPublishing(true); setError(null);
    const data = { title, content, baseRevision };
    try {
      await queue.current;
      await api(`${base}/draft`, { method: 'PUT', body: JSON.stringify(data) });
      await api(`${base}/publish`, { method: 'POST', body: JSON.stringify(data) });
      try { sessionStorage.removeItem(storageKey); } catch { /* No persisted local draft. */ }
      done();
    } catch (err) { setError(err); setPublishing(false); }
  }
  return <div className="document-edit"><label className="document-name">Название страницы<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={250} disabled={publishing} /></label><div className="document-import"><label className="button button-outline upload-label">Импорт Markdown<input type="file" aria-label="Импорт Markdown" accept=".md,.markdown,.txt" disabled={publishing} onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 500000) setError(new Error('Выберите файл до 500 КБ')); else void file.text().then(text => { const parsed = importMarkdown(text); setContent(parsed); setSeed(parsed); setReset(n => n + 1); }).catch(setError); } e.target.value = ''; }} /></label></div><RichEditor label="Содержимое страницы" key={reset} content={seed} editable={!publishing} onChange={setContent} insertImage={insertImage} mentionUrl={`${base}/mentions`} /><Attachments kind="page" id={page.id} canEdit={!publishing} onInsertImage={src => setInsertImage(previous => ({ src, sequence: (previous?.sequence ?? 0) + 1 }))} />{error !== null && <ErrorMessage error={error} />}<div className="editor-savebar"><span role="status">{status}</span><div className="inline-actions">{page.revision !== baseRevision && <Button variant="outline" onClick={() => setCompare(true)}>Сравнить новую версию</Button>}<Button variant="outline" disabled={publishing} onClick={async () => { clearTimeout(timer.current); try { await queue.current; await api(`${base}/draft`, { method: 'PUT', body: JSON.stringify({ title, content, baseRevision }) }); done(); } catch (err) { setError(err); } }}>Сохранить черновик и закрыть</Button><Button disabled={publishing || !title.trim()} onClick={() => { void publish(); }}>{publishing ? 'Публикация…' : 'Опубликовать'}</Button></div></div>{compare && <Modal title="Есть новая опубликованная версия" description="Сравните текст и внесите нужные изменения в свой черновик. Опубликованная версия не будет заменена без вашего действия." close={() => setCompare(false)}><div className="version-comparison"><h3>Опубликовано, версия {page.revision}</h3><pre>{documentText(page.content)}</pre><h3>Ваш черновик, основан на версии {baseRevision}</h3><pre>{documentText(content)}</pre></div><Button onClick={() => { setBaseRevision(page.revision); setCompare(false); }}>Продолжить редактирование на основе версии {page.revision}</Button></Modal>}</div>;
}

function PageContents({ content, prefix }: { content: RichDocument; prefix: string }) {
  const headings: { text: string; level: number }[] = [];
  const walk = (node: RichNode) => { if (node.type === 'heading') headings.push({ text: documentText(node).trim(), level: Number(node.attrs?.level ?? 1) }); node.content?.forEach(walk); };
  walk(content);
  return headings.length ? <details className="document-toc"><summary>Оглавление</summary><nav>{headings.map((heading, index) => <a key={index} href={`#${prefix}-heading-${index}`} style={{ paddingLeft: (heading.level - 1) * 12 }}>{heading.text}</a>)}</nav></details> : null;
}
