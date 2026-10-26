import { describe, expect, it } from 'vitest';
import { validDocument, safeLink } from '../../packages/validation/src/knowledge';
import { createTaskSchema, updateTaskSchema } from '../../packages/validation/src/work';
import { uploadSchema } from '../../packages/validation/src/platform';
import { encryptSecret, decryptSecret } from '../../packages/config/src/secrets';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importMarkdown, tableMarkdown } from '../../apps/web/src/lib/markdown';

describe('rich documents', () => {
  it('accepts structured tables, lists and protected images', () => {
    expect(validDocument({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Раздел' }] }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null }, content: [{ type: 'paragraph' }] }] }] }, { type: 'image', attrs: { src: '/api/files/12345678-1234-1234-1234-123456789012/download?inline=1' } }] })).toBe(true);
  });
  it('rejects executable links, tracking images and unsupported nodes', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hello', '//evil.invalid', '/\\evil.invalid', 'https://a.invalid\u0000']) expect(safeLink(href)).toBe(false);
    for (const href of ['https://example.org/a', '/projects/id', 'mailto:user@example.org', '#section']) expect(safeLink(href)).toBe(true);
    expect(validDocument({ type: 'doc', content: [{ type: 'script', text: 'x' }] })).toBe(false);
    expect(validDocument({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.org/tracker' } }] })).toBe(false);
  });
  it('rejects arbitrary table alignment values', () => {
    expect(validDocument({ type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { align: 'url(javascript:alert(1))' }, content: [{ type: 'paragraph' }] }] }] }] })).toBe(false);
  });
  it('rejects malformed nesting, excessive depth and class injection', () => {
    expect(validDocument({ type: 'doc', content: [{ type: 'text', text: 'Root text' }] })).toBe(false);
    expect(validDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'table' }] }] })).toBe(false);
    expect(validDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '/x', class: 'sidebar' } }] }] }] })).toBe(false);
    let value: unknown = { type: 'paragraph' }; for (let i = 0; i < 30; i++) value = { type: 'blockquote', content: [value] };
    expect(validDocument({ type: 'doc', content: [value] })).toBe(false);
  });
});
describe('platform input boundaries', () => {
  it('bounds file size and excludes client filesystem paths', () => {
    for (const name of ['../private', 'a/b', 'a\\b', 'line\nheader']) expect(uploadSchema.safeParse({ name, size: 10 }).success).toBe(false);
    expect(uploadSchema.safeParse({ name: 'Документ.pdf', size: 26214400 }).success).toBe(true);
    expect(uploadSchema.safeParse({ name: 'x', size: 26214401 }).success).toBe(false);
  });
  it('accepts project status keys but never client-controlled authors or organizations', () => {
    expect(updateTaskSchema.safeParse({ version: 1, status: 'WAITING' }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'x', organizationId: 'injected' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 1, authorId: 'injected' }).success).toBe(false);
  });
});
describe('local Markdown import/export', () => {
  it('imports headings, safe inline formatting, tasks, code and tables as validated JSON', () => {
    const value = importMarkdown('# Инструкция\n\n**Текст** и [ссылка](/projects)\n\n- [x] Готово\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```');
    expect(validDocument(value)).toBe(true); expect(value.content.some(n => n.type === 'table')).toBe(true);
    expect(tableMarkdown(value.content.find(n => n.type === 'table')!)).toContain('| A | B |');
  });
  it('keeps HTML and executable links inert and bounds imported text', () => {
    const value = importMarkdown('<script>alert(1)</script>\n\n[unsafe](javascript:alert)');
    expect(validDocument(value)).toBe(true); expect(JSON.stringify(value)).not.toContain('"type":"link"');
    expect(() => importMarkdown('x'.repeat(500001))).toThrow();
  });
});
describe('mail secret vault', () => {
  it('uses randomized authenticated encryption scoped to the organization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vnt-secret-'));
    try {
      const one = await encryptSecret(root, 'org-one', 'test-value'); const two = await encryptSecret(root, 'org-one', 'test-value');
      expect(one).not.toBe(two); expect(one).not.toContain('test-value');
      expect(await decryptSecret(root, 'org-one', one)).toBe('test-value');
      await expect(decryptSecret(root, 'org-two', one)).rejects.toThrow();
      const original = await readFile(join(root, '.keys', 'mail.key'));
      await expect(decryptSecret(root, 'org-one', one.slice(0, -3) + 'ABC')).rejects.toThrow();
      expect((await readFile(join(root, '.keys', 'mail.key'))).equals(original)).toBe(true);
    } finally { await rm(root, { recursive: true }); }
  });
  it('does not recreate a missing key while decrypting and rejects symlink key directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vnt-secret-'));
    try {
      await expect(decryptSecret(root, 'org', 'AAAA.AAAA.AAAA')).rejects.toThrow();
      const other = join(root, 'other'); await mkdir(other); await rm(join(root, '.keys'), { recursive: true }); await symlink(other, join(root, '.keys'));
      await expect(encryptSecret(root, 'org', 'test-value')).rejects.toThrow();
    } finally { await rm(root, { recursive: true }); }
  });
});
