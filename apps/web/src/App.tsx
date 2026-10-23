import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderKanban, Monitor, Settings, LogOut, Moon, Sun, PanelLeftClose, Menu, ShieldCheck } from 'lucide-react';
import { Button } from '@ventilyator/ui';
import type { CurrentUser } from '@ventilyator/shared';
import { api, ApiError } from './lib/api';
import { usePreferences } from './lib/preferences';
import { Brand, Loading, ErrorMessage } from './components/common';
import { Login } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { Admin } from './pages/Admin';
import { Projects } from './pages/Projects';
import { Project } from './pages/Project';
import { Task } from './pages/Task';

export function App() {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const [menu, setMenu] = useState(false);
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<CurrentUser>('/auth/me'), refetchInterval: 60000 });
  const logout = useMutation({ mutationFn: () => api('/auth/logout', { method: 'POST' }), onSuccess: () => client.resetQueries() });
  useEffect(() => { document.documentElement.classList.toggle('dark', preferences.dark); document.documentElement.classList.toggle('compact', preferences.compact); }, [preferences.dark, preferences.compact]);
  if (me.isLoading) return <main className="loading-page"><Brand /><Loading /></main>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
  if (me.isError || !me.data) return <main className="loading-page"><ErrorMessage error={me.error} /><Button onClick={() => { void me.refetch(); }}>Повторить</Button></main>;
  const user = me.data;
  const admin = user.permissions.some(p => ['system:read', 'users:manage', 'audit:read'].includes(p));
  return <div className="app-shell"><aside className={menu ? 'sidebar mobile-open' : 'sidebar'}><Brand /><p className="sidebar-label">{t('workspace')}</p><nav onClick={() => setMenu(false)}><NavLink end to="/"><FolderKanban size={18} />Проекты</NavLink><NavLink to="/sessions"><Monitor size={18} />{t('sessions')}</NavLink>{admin && <NavLink to="/admin"><Settings size={18} />{t('admin')}</NavLink>}</nav><div className="sidebar-bottom"><ShieldCheck size={20} /><p>Внутри организации<small>Автономная инфраструктура</small></p></div></aside><div className="main-shell"><header className="topbar"><Button variant="ghost" className="mobile-menu" aria-label="Открыть меню" onClick={() => setMenu(!menu)}><Menu size={20} /></Button><span className="breadcrumb">Ventilyator <span>/</span> {t('workspace')}</span><div className="top-actions"><Button variant="ghost" aria-label="Компактный режим" aria-pressed={preferences.compact} onClick={preferences.toggleCompact}><PanelLeftClose size={18} /></Button><Button variant="ghost" aria-label="Переключить тему" onClick={preferences.toggleTheme}>{preferences.dark ? <Sun size={18} /> : <Moon size={18} />}</Button><span className="avatar" title={user.email}>{user.name.slice(0, 1).toUpperCase()}</span><Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()} aria-label={t('logout')}><LogOut size={18} /></Button></div></header><main className="content">{logout.isError && <ErrorMessage error={logout.error} />}<Routes><Route path="/" element={<Projects user={user} />} /><Route path="/projects/:projectId" element={<Project />} /><Route path="/projects/:projectId/tasks/:taskId" element={<Task />} /><Route path="/sessions" element={<Sessions />} /><Route path="/admin" element={admin ? <Admin user={user} /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main><footer>Ventilyator <span>Данные вашей организации — на вашем сервере.</span></footer></div></div>;
}
