import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@ventilyator/ui';
import { HardDrive, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { ErrorMessage, Loading } from '../components/common';
import { formatBytes } from '../components/Attachments';
export function StorageAdmin() {
  const client = useQueryClient();
  const update = useMutation({ mutationFn: (bytes: number) => api('/files/quota', { method: 'PUT', body: JSON.stringify({ bytes }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['storage-status'] }); } });
  const reconcile = useMutation({ mutationFn: () => api<{ cleaned: number }>('/files/reconcile', { method: 'POST' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['storage-status'] }); } });
  const status = useQuery({ queryKey: ['storage-status'], queryFn: () => api<{ usedBytes: number; objects: number; versions: number; trash: number; pending: number; quotaBytes: number; diskFreeBytes: number; antivirusRequired: boolean }>('/files/status'), refetchInterval: 15000 });
  if (status.isLoading) return <Loading />;
  if (!status.data || status.isError) return <ErrorMessage error={status.error} />;
  const data = status.data;
  return <><div className="metric-grid">{[['Файлы организации', String(data.objects)], ['Все версии', String(data.versions)], ['Занято', formatBytes(data.usedBytes)], ['Свободно на диске', formatBytes(data.diskFreeBytes)]].map(([title, value]) => <article className="panel metric" key={title}><HardDrive size={20} /><span>{title}</span><strong>{value}</strong></article>)}</div><section className="panel info-panel"><h2>Локальное хранилище</h2><p>Квота организации: {formatBytes(data.quotaBytes)}. В корзине: {data.trash}. Незавершённых и неуспешных загрузок: {data.pending}.</p><div className="storage-meter"><span style={{ width: `${Math.min(100, data.usedBytes / data.quotaBytes * 100)}%` }} /></div><p><ShieldCheck size={16} /> Антивирусная проверка: {data.antivirusRequired ? 'Обязательна' : 'Не включена'}</p><p>Имена и ссылки файлов не дают прямого доступа к диску. Скачивание проверяет доступ к задаче или странице. SHA-256 и версии доступны в карточке вложения.</p><form className="inline-form" onSubmit={e => { e.preventDefault(); update.mutate(Math.round(Number(new FormData(e.currentTarget).get('gib')) * 1073741824)); }}><label>Квота организации, ГБ<input name="gib" type="number" min={0.001} max={10240} step={0.001} defaultValue={Math.round(data.quotaBytes / 1073741824 * 1000) / 1000} required /></label><Button type="submit" disabled={update.isPending}>Обновить квоту</Button></form>{update.isError && <ErrorMessage error={update.error} />}<Button variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>Очистить истёкшие незавершённые загрузки</Button>{reconcile.isError && <ErrorMessage error={reconcile.error} />}{reconcile.isSuccess && <p role="status">Обработано загрузок: {reconcile.data.cleaned}</p>}</section></>;
}
