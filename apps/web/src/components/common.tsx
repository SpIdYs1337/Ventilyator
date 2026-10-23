import { AlertCircle, Wind } from 'lucide-react';
export function Brand() { return <div className="brand"><span className="brand-icon"><Wind size={24} /></span><span>Ventilyator<small>КОРПОРАТИВНАЯ ПЛАТФОРМА</small></span></div>; }
export function ErrorMessage({ error }: { error: unknown }) { return <div role="alert" className="error"><AlertCircle size={18} />{error instanceof Error ? error.message : 'Не удалось загрузить данные. Проверьте соединение.'}</div>; }
export function Loading() { return <div className="skeleton" role="status" aria-label="Загрузка" />; }
export function Empty({ title, description }: { title: string; description: string }) { return <div className="empty"><Wind size={36} strokeWidth={1.2} /><h2>{title}</h2><p>{description}</p></div>; }
