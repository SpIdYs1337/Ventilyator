import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@ventilyator/ui';
import { ArrowRight, ShieldCheck, Server, FolderLock } from 'lucide-react';
import { api } from '../lib/api';
import { Brand, ErrorMessage } from '../components/common';

const schema = z.object({ email: z.email(), password: z.string().min(1), remember: z.boolean(), provider: z.enum(['local', 'imap']) });
export function Login() {
  const query = useQueryClient();
  const [showImap, setShowImap] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '', remember: false, provider: 'local' } });
  const login = useMutation({ mutationFn: (data: z.infer<typeof schema>) => api('/auth/login', { method: 'POST', body: JSON.stringify(data) }), onSuccess: () => { form.resetField('password'); void query.invalidateQueries(); } });
  return <main className="login-shell"><section className="login-story"><Brand /><div><span className="eyebrow">ОДНО ПРОСТРАНСТВО. ОБЩАЯ ЦЕЛЬ.</span><h1>Работа движется,<br />когда всё рядом.</h1><p>Ventilyator объединяет команду и рабочие процессы внутри вашей организации.</p><div className="story-lines"><span><Server size={18} /> На вашем сервере</span><span><FolderLock size={18} /> Данные под вашим контролем</span><span><ShieldCheck size={18} /> Без обязательных облачных сервисов</span></div></div><small>VENTILYATOR / ВНУТРЕННЯЯ ИНФОРМАЦИОННАЯ СИСТЕМА</small></section><section className="login-form"><div className="login-card"><span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</span><h2>Вход в Ventilyator</h2><p className="muted">Используйте учётную запись организации.</p><form onSubmit={form.handleSubmit(data => login.mutate(data))}><label>Рабочая почта<input type="email" autoComplete="username" required {...form.register('email')} /></label><label>Пароль<input type="password" autoComplete="current-password" required {...form.register('password')} /></label><label className="checkbox"><input type="checkbox" {...form.register('remember')} />Запомнить меня на этом устройстве</label>{showImap && <label>Способ входа<select {...form.register('provider')}><option value="local">Локальная учётная запись</option><option value="imap">Корпоративная почта (IMAP)</option></select></label>}{Object.keys(form.formState.errors).length > 0 && <p role="alert" className="error">Укажите корректные email и пароль.</p>}{login.isError && <ErrorMessage error={login.error} />}<Button type="submit" disabled={login.isPending}>{login.isPending ? 'Проверяем…' : 'Войти в рабочее пространство'}<ArrowRight size={17} /></Button></form><Button variant="ghost" onClick={() => setShowImap(s => !s)}>{showImap ? 'Скрыть способы входа' : 'Вход через корпоративную почту'}</Button><p className="login-note">Нет учётной записи? Обратитесь к администратору вашей организации.</p></div></section></main>;
}
