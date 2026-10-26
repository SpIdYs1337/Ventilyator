export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-Ventilyator-Request': '1', ...options.headers } });
  const text = await res.text();
  if (!res.ok) {
    let message = 'Сервис недоступен. Повторите запрос позже.';
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') message = body.message;
    } catch { /* Proxy and unavailable services may return a non-JSON response. */ }
    throw new ApiError(res.status, message);
  }
  // Nest/Express can send an empty 200 for null; older API images do this for
  // mail settings before the first save. 204 also deliberately has no body.
  if (!text.trim()) return null as T;
  try { return JSON.parse(text) as T; }
  catch { throw new ApiError(res.status, 'Сервис вернул некорректный ответ. Обновите страницу и повторите запрос.'); }
}
