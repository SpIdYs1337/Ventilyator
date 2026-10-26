import { PasswordChange } from '../components/PasswordChange';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, LogOut } from 'lucide-react';
import { Button } from '@ventilyator/ui';
import { api } from '../lib/api';
import { ErrorMessage, Loading } from '../components/common';
type Session = { id: string; current: boolean; userAgent: string; createdAt: string; expiresAt: string };
export function Sessions() {
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/auth/sessions') });
  const revoke = useMutation({ mutationFn: (id?: string) => api(id ? `/auth/sessions/${id}` : '/auth/logout-all', { method: id ? 'DELETE' : 'POST' }), onSuccess: () => { void client.invalidateQueries(); } });
  return <><div className="page-heading"><div><span className="eyebrow">БЕЗОПАСНОСТЬ</span><h1>Мои устройства</h1><p>Управляйте доступом к своей учётной записи.</p></div><Button variant="outline" disabled={revoke.isPending} onClick={() => { if (confirm('Завершить все сессии, включая текущую?')) revoke.mutate(undefined); }}><LogOut size={16} />Выйти на всех устройствах</Button></div>{sessions.isLoading && <Loading />}{sessions.isError && <ErrorMessage error={sessions.error} />}{revoke.isError && <ErrorMessage error={revoke.error} />}<div className="panel">{sessions.data?.map(s => <div className="session-row" key={s.id}><Monitor size={22} /><div><strong>{s.current ? 'Это устройство' : 'Другое устройство'}</strong><p className="agent">{s.userAgent}</p><small>Вход: {new Date(s.createdAt).toLocaleString('ru-RU')} · Предел сессии: {new Date(s.expiresAt).toLocaleString('ru-RU')}</small></div><Button variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>Завершить</Button></div>)}</div><p className="muted footnote">Неактивные сессии завершаются через 7 дней, с «Запомнить меня» — через 30 дней. Максимальный срок ограничен серверной настройкой.</p><PasswordChange /></>;
}
