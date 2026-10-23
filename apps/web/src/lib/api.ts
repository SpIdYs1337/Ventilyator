export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-Ventilyator-Request': '1', ...options.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Сервис недоступен' })) as { message?: string };
    throw new ApiError(res.status, typeof body.message === 'string' ? body.message : 'Не удалось выполнить запрос');
  }
  return res.json() as Promise<T>;
}
