import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Monitor, Settings, LogOut, Moon, Sun, PanelLeftClose, Menu, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { Button } from '@ventilyator/ui';
import type { CurrentUser } from '@ventilyator/shared';
import { api, ApiError } from './lib/api';
import { usePreferences } from './lib/preferences';
import { Brand, Loading, ErrorMessage, Empty } from './components/common';
import { Login } from './pages/Login';
import { Sessions } from './pages/Sessions';
import { Admin } from './pages/Admin';

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
  return <div className="app-shell"><aside className={menu ? 'sidebar mobile-open' : 'sidebar'}><Brand /><p className="sidebar-label">{t('workspace')}</p><nav onClick={() => setMenu(false)}><NavLink end to="/"><LayoutDashboard size={18} />{t('home')}</NavLink><NavLink to="/sessions"><Monitor size={18} />{t('sessions')}</NavLink>{admin && <NavLink to="/admin"><Settings size={18} />{t('admin')}</NavLink>}</nav><div className="sidebar-bottom"><ShieldCheck size={20} /><p>Внутри организации<small>Автономная инфраструктура</small></p></div></aside><div className="main-shell"><header className="topbar"><Button variant="ghost" className="mobile-menu" aria-label="Открыть меню" onClick={() => setMenu(!menu)}><Menu size={20} /></Button><span className="breadcrumb">Ventilyator <span>/</span> {t('workspace')}</span><div className="top-actions"><Button variant="ghost" aria-label="Компактный режим" aria-pressed={preferences.compact} onClick={preferences.toggleCompact}><PanelLeftClose size={18} /></Button><Button variant="ghost" aria-label="Переключить тему" onClick={preferences.toggleTheme}>{preferences.dark ? <Sun size={18} /> : <Moon size={18} />}</Button><span className="avatar" title={user.email}>{user.name.slice(0, 1).toUpperCase()}</span><Button variant="ghost" disabled={logout.isPending} onClick={() => logout.mutate()} aria-label={t('logout')}><LogOut size={18} /></Button></div></header><main className="content">{logout.isError && <ErrorMessage error={logout.error} />}<Routes><Route path="/" element={<><div className="page-heading"><div><span className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Здравствуйте, {user.name}.</h1><p>Ventilyator · единая среда вашей команды.</p></div><span className="badge"><span className="dot" />Сессия защищена</span></div><section className="welcome-panel"><div><span className="eyebrow">НАЧАЛО РАБОТЫ</span><h2>Команда начинается<br />с безопасного доступа.</h2><p>Управляйте своими устройствами и доступом сотрудников.<br />Новые рабочие модули будут добавляться поэтапно.</p><Button asChild variant="outline"><Link to="/sessions">Мои устройства<ArrowUpRight size={16} /></Link></Button></div><div className="welcome-mark" aria-hidden="true"><ShieldCheck size={112} strokeWidth={0.8} /></div></section><div className="section-heading"><h2>Доступные разделы</h2><span className="muted">Инфраструктура и доступ</span></div><div className="feature-grid"><Link className="panel feature" to="/sessions"><Monitor size={24} /><h3>Мои устройства</h3><p>Активные сеансы и завершение доступа.</p><span>Открыть <ArrowUpRight size={14} /></span></Link>{admin && <Link className="panel feature" to="/admin"><Settings size={24} /><h3>Администрирование</h3><p>Состояние сервисов, пользователи и аудит.</p><span>Открыть <ArrowUpRight size={14} /></span></Link>}</div><Empty title="Рабочие модули — следующие этапы" description="Проекты, задачи и база знаний ещё не реализованы. Здесь пока нет рабочих данных или демонстрационных показателей." /></>} /><Route path="/sessions" element={<Sessions />} /><Route path="/admin" element={admin ? <Admin user={user} /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></main><footer>Ventilyator <span>Данные вашей организации — на вашем сервере.</span></footer></div></div>;
}
