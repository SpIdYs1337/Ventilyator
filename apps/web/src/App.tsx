import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderKanban, Monitor, Settings, LogOut, Moon, Sun, PanelLeftClose, PanelLeftOpen, Menu, ShieldCheck, BookOpen, LayoutDashboard, CalendarDays, Search, Bell } from 'lucide-react';
import { Button } from '@ventilyator/ui';
import type { CurrentUser } from '@ventilyator/shared';
import { api, ApiError } from './lib/api';
import { usePreferences } from './lib/preferences';
import { Brand, Loading, ErrorMessage } from './components/common';
import { Login } from './pages/Login';
import { SectionBoundary } from './components/SectionBoundary';








const Sessions = lazy(() => import('./pages/Sessions').then(module => ({ default: module.Sessions })));
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })));
const Projects = lazy(() => import('./pages/Projects').then(module => ({ default: module.Projects })));
const Project = lazy(() => import('./pages/Project').then(module => ({ default: module.Project })));
const Task = lazy(() => import('./pages/Task').then(module => ({ default: module.Task })));
const Dashboard = lazy(() => import('./pages/Portal').then(module => ({ default: module.Dashboard })));
const Notifications = lazy(() => import('./pages/Portal').then(module => ({ default: module.Notifications })));
const GlobalSearch = lazy(() => import('./pages/Portal').then(module => ({ default: module.GlobalSearch })));
const Calendar = lazy(() => import('./pages/Portal').then(module => ({ default: module.Calendar })));
const Knowledge = lazy(() => import('./pages/Knowledge').then(module => ({ default: module.Knowledge })));
const KnowledgeSpace = lazy(() => import('./pages/Knowledge').then(module => ({ default: module.KnowledgeSpace })));

export function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
  const admin = user.permissions.some(p => ['system:read', 'users:manage', 'audit:read', 'mail:manage', 'storage:manage', 'roles:manage'].includes(p));
  return <div className="app-shell"><aside id="workspace-sidebar" aria-label="Основная навигация" className={menu ? 'sidebar mobile-open' : 'sidebar'}><Brand /><p className="sidebar-label">{t('workspace')}</p><nav onClick={() => setMenu(false)}><NavLink end to="/" aria-label="Рабочий стол" title="Рабочий стол"><LayoutDashboard size={18} /><span className="nav-label">Рабочий стол</span></NavLink><NavLink to="/projects" aria-label="Проекты и задачи" title="Проекты и задачи"><FolderKanban size={18} /><span className="nav-label">Проекты и задачи</span></NavLink><NavLink to="/knowledge" aria-label="База знаний" title="База знаний"><BookOpen size={18} /><span className="nav-label">База знаний</span></NavLink><NavLink to="/calendar" aria-label="Календарь" title="Календарь"><CalendarDays size={18} /><span className="nav-label">Календарь</span></NavLink><NavLink to="/notifications" aria-label="Уведомления" title="Уведомления"><Bell size={18} /><span className="nav-label">Уведомления</span></NavLink><NavLink to="/search" aria-label="Поиск" title="Поиск"><Search size={18} /><span className="nav-label">Поиск</span></NavLink><span className="nav-divider" /><NavLink to="/sessions" aria-label={t('sessions')} title={t('sessions')}><Monitor size={18} /><span className="nav-label">{t('sessions')}</span></NavLink>{admin && <NavLink to="/admin" aria-label={t('admin')} title={t('admin')}><Settings size={18} /><span className="nav-label">{t('admin')}</span></NavLink>}</nav><div className="sidebar-bottom"><ShieldCheck size={20} /><p>Внутри организации<small>Автономная инфраструктура</small></p></div></aside><div className="main-shell"><header className="topbar"><Button variant="ghost" className="mobile-menu" aria-label="Открыть меню" onClick={() => setMenu(!menu)}><Menu size={20} /></Button><form className="header-search" onSubmit={e => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(String(new FormData(e.currentTarget).get('q') ?? ''))}`); }}><Search size={17} /><input name="q" aria-label="Поиск в Ventilyator" placeholder="Найти задачу или страницу…" maxLength={200} /><kbd>Поиск</kbd></form><div className="top-actions"><HeaderNotifications /><Button variant="ghost" aria-label="Компактный режим" aria-controls="workspace-sidebar" aria-pressed={preferences.compact} title={preferences.compact ? 'Обычный режим' : 'Компактный режим'} onClick={preferences.toggleCompact}>{preferences.compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</Button><Button variant="ghost" aria-label="Переключить тему" onClick={preferences.toggleTheme}>{preferences.dark ? <Sun size={18} /> : <Moon size={18} />}</Button><span className="avatar" title={user.email}>{user.name.slice(0, 1).toUpperCase()}</span><Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()} aria-label={t('logout')}><LogOut size={18} /></Button></div></header><main className="content">{logout.isError && <ErrorMessage error={logout.error} />}<SectionBoundary key={location.pathname}><Suspense fallback={<Loading />}><Routes><Route path="/" element={<Dashboard user={user} />} /><Route path="/projects" element={<Projects user={user} />} /><Route path="/knowledge" element={<Knowledge user={user} />} /><Route path="/knowledge/:spaceId" element={<KnowledgeSpace user={user} />} /><Route path="/knowledge/:spaceId/pages/:pageId" element={<KnowledgeSpace user={user} />} /><Route path="/calendar" element={<Calendar />} /><Route path="/notifications" element={<Notifications />} /><Route path="/search" element={<GlobalSearch />} /><Route path="/projects/:projectId" element={<Project />} /><Route path="/projects/:projectId/tasks/:taskId" element={<Task />} /><Route path="/sessions" element={<Sessions />} /><Route path="/admin" element={admin ? <Admin user={user} /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></SectionBoundary></main><footer>Ventilyator <span>Данные вашей организации — на вашем сервере.</span></footer></div></div>;
}

function HeaderNotifications() {
  const notices = useQuery({ queryKey: ['notifications', 'header'], queryFn: () => api<{ unreadCount: number }>('/notifications?q=unread'), refetchInterval: 15000 });
  return <Link className="notification-bell" to="/notifications" aria-label="Открыть уведомления"><Bell size={18} />{Boolean(notices.data?.unreadCount) && <span>{Math.min(notices.data!.unreadCount, 99)}</span>}</Link>;
}
