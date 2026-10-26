import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../apps/web/src/lib/api';

function reply(response: Response) { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response)); }
afterEach(() => vi.unstubAllGlobals());

describe('API response protocol', () => {
  it('accepts an empty successful response from an older API', async () => {
    reply(new Response('', { status: 200 }));
    await expect(api('/admin/mail')).resolves.toBeNull();
  });
  it('accepts an intentional no-content response', async () => {
    reply(new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });
  it('keeps JSON null and populated settings valid', async () => {
    reply(Response.json(null));
    await expect(api('/admin/mail')).resolves.toBeNull();
    const settings = { imapEnabled: false, imapPort: 993, smtpPasswordSet: false };
    reply(Response.json(settings));
    await expect(api('/admin/mail')).resolves.toEqual(settings);
  });
  it('reports malformed success responses without exposing a parser exception', async () => {
    reply(new Response('{', { status: 200 }));
    await expect(api('/admin/mail')).rejects.toMatchObject({ name: 'Error', status: 200, message: 'Сервис вернул некорректный ответ. Обновите страницу и повторите запрос.' });
  });
  it('keeps an HTTP error and its safe API message', async () => {
    reply(Response.json({ message: 'Недостаточно прав' }, { status: 403 }));
    const result = api('/admin/mail');
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 403, message: 'Недостаточно прав' });
  });
  it('does not interpret empty errors as successful defaults or display proxy HTML', async () => {
    for (const body of ['', '<html>private upstream details</html>']) {
      reply(new Response(body, { status: 503 }));
      await expect(api('/admin/mail')).rejects.toMatchObject({ status: 503, message: 'Сервис недоступен. Повторите запрос позже.' });
    }
  });
});
