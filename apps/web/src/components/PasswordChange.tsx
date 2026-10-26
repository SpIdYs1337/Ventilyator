import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ventilyator/ui';
import { api } from '../lib/api';
import { ErrorMessage } from './common';
export function PasswordChange() {
  const [error, setError] = useState(''); const client = useQueryClient();
  const change = useMutation({ mutationFn: (data: Record<string, unknown>) => api('/auth/password', { method: 'POST', body: JSON.stringify(data) }), onSuccess: () => { void client.resetQueries(); } });
  return <section className="panel info-panel"><h2>Смена локального пароля</h2><p>После смены все ваши сессии завершаются. Войдите заново с новым паролем.</p><form className="password-form" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); if (f.password !== f.confirm) { setError('Пароли не совпадают'); return; } setError(''); change.mutate({ currentPassword: f.currentPassword, password: f.password }); }}><label>Текущий локальный пароль<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} /></label><label>Новый локальный пароль<input type="password" name="password" autoComplete="new-password" required minLength={14} maxLength={256} /></label><label>Повторите новый пароль<input type="password" name="confirm" autoComplete="new-password" required minLength={14} maxLength={256} /></label>{error && <p role="alert" className="error">{error}</p>}{change.isError && <ErrorMessage error={change.error} />}<Button type="submit" disabled={change.isPending}>Изменить пароль</Button></form></section>;
}
