import { z } from 'zod';
export interface RichNode { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: RichNode[] }
const nodes = new Set(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'mention']);
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'highlight', 'textStyle']);
export function safeLink(value: unknown): boolean {
  if (typeof value !== 'string' || Array.from(value).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || c === '\\')) return false;
  if (/^\/(?!\/)/.test(value) || value.startsWith('#')) return true;
  try { return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; }
}
export function validDocument(value: unknown): value is RichNode {
  let count = 0;
  function walk(v: unknown, depth: number): boolean {
    if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 25 || ++count > 10000) return false;
    const n = v as RichNode;
    if (!nodes.has(n.type) || Object.keys(n).some(k => !['type', 'text', 'attrs', 'content', 'marks'].includes(k))) return false;
    const children = n.content ?? [];
    const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'image']);
    if (n.content !== undefined && !Array.isArray(n.content)) return false;
    if (['text', 'hardBreak', 'horizontalRule', 'image', 'mention'].includes(n.type) && children.length) return false;
    if (['doc', 'blockquote', 'tableCell', 'tableHeader'].includes(n.type) && (!children.length || children.some(c => !c || !blockTypes.has(c.type)))) return false;
    if (['paragraph', 'heading'].includes(n.type) && children.some(c => !c || !['text', 'hardBreak', 'mention'].includes(c.type))) return false;
    if (n.type === 'codeBlock' && children.some(c => !c || c.type !== 'text' || c.marks?.length)) return false;
    if (['bulletList', 'orderedList', 'taskList', 'table', 'tableRow'].includes(n.type)) {
      const allowed = n.type === 'taskList' ? ['taskItem'] : n.type === 'table' ? ['tableRow'] : n.type === 'tableRow' ? ['tableCell', 'tableHeader'] : ['listItem'];
      if (!children.length || children.some(c => !c || !allowed.includes(c.type))) return false;
    }
    if (['listItem', 'taskItem'].includes(n.type) && (!children.length || children[0]?.type !== 'paragraph' || children.some(c => !c || !blockTypes.has(c.type)))) return false;
    if (n.type === 'text' && (typeof n.text !== 'string' || n.text.length > 200000)) return false;
    if (n.type === 'mention' && (!n.attrs || !z.uuid().safeParse(n.attrs.id).success || typeof n.attrs.label !== 'string' || !n.attrs.label.trim() || n.attrs.label.length > 100 || Object.keys(n.attrs).some(key => !['id', 'label'].includes(key)))) return false;
    const attrs = n.attrs;
    if (attrs) {
      if (typeof attrs !== 'object' || Array.isArray(attrs) || Object.keys(attrs).some(k => !['level', 'start', 'checked', 'language', 'colspan', 'rowspan', 'colwidth', 'src', 'alt', 'title', 'width', 'height', 'textAlign', 'align', 'id', 'label'].includes(k))) return false;
      if (attrs.level !== undefined && ![1, 2, 3, 4, 5, 6].includes(Number(attrs.level))) return false;
      if (attrs.src !== undefined && (typeof attrs.src !== 'string' || !/^\/api\/files\/[0-9a-f-]{36}\/download\?inline=1$/.test(attrs.src))) return false;
      for (const key of ['alt', 'title', 'language']) if (attrs[key] !== undefined && attrs[key] !== null && (typeof attrs[key] !== 'string' || String(attrs[key]).length > 500)) return false;
      if (attrs.language != null && !/^[a-z0-9+#_.-]{0,40}$/i.test(String(attrs.language))) return false;
      for (const key of ['start', 'colspan', 'rowspan', 'width', 'height']) if (attrs[key] !== undefined && attrs[key] !== null && (!Number.isInteger(attrs[key]) || Number(attrs[key]) < 1 || Number(attrs[key]) > 10000)) return false;
      if (attrs.colwidth !== undefined && attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.length > 20 || attrs.colwidth.some(v => !Number.isInteger(v) || v < 1 || v > 10000))) return false;
      if (attrs.align !== undefined && !['left', 'center', 'right', null].includes(attrs.align as string)) return false;
      if (attrs.textAlign !== undefined && !['left', 'center', 'right', null].includes(attrs.textAlign as string)) return false;
      if (attrs.checked !== undefined && typeof attrs.checked !== 'boolean') return false;
    }
    if (n.marks && (!Array.isArray(n.marks) || n.marks.length > 10 || n.marks.some(m => {
      if (!marks.has(m.type) || Object.keys(m).some(k => !['type', 'attrs'].includes(k))) return true;
      if (m.attrs !== undefined && (!m.attrs || typeof m.attrs !== 'object' || Array.isArray(m.attrs))) return true;
      if (m.attrs && Object.keys(m.attrs).some(k => !['href', 'target', 'rel', 'class', 'color', 'title'].includes(k))) return true;
      if (m.attrs?.title != null && (typeof m.attrs.title !== 'string' || m.attrs.title.length > 500)) return true;
      if (m.attrs?.class) return true;
      if (m.type === 'link' && (!safeLink(m.attrs?.href) || (m.attrs?.target != null && !['_blank', '_self'].includes(String(m.attrs.target))))) return true;
      if (m.attrs?.color && !/^#[0-9a-f]{3,8}$/i.test(String(m.attrs.color))) return true;
      return false;
    }))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(c => walk(c, depth + 1)));
  }
  try { return (value as RichNode)?.type === 'doc' && JSON.stringify(value).length <= 1000000 && walk(value, 0); } catch { return false; }
}
export const documentSchema = z.custom<RichNode>(validDocument, 'Некорректный документ');
export const spaceSchema = z.object({ key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,19}$/), name: z.string().trim().min(1).max(150), description: z.string().max(20000).default('') }).strict();
export const pageCreateSchema = z.object({ title: z.string().trim().min(1).max(250), parentId: z.uuid().nullable().default(null) }).strict();
export const pageSaveSchema = z.object({ title: z.string().trim().min(1).max(250), content: documentSchema, baseRevision: z.number().int().nonnegative() }).strict();
export const pageMoveSchema = z.object({ parentId: z.uuid().nullable().optional(), archived: z.boolean().optional(), revision: z.number().int().nonnegative(), sortOrder: z.number().int().min(0).max(100000).optional() }).strict();
export const workflowSchema = z.object({ statuses: z.array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/), name: z.string().trim().min(1).max(60), done: z.boolean(), wipLimit: z.number().int().min(0).max(5000).optional() }).strict()).min(2).max(20), transitions: z.array(z.object({ from: z.string().max(40), to: z.string().max(40), managerOnly: z.boolean() }).strict()).max(400) }).strict().refine(w => new Set(w.statuses.map(s => s.key)).size === w.statuses.length && w.statuses.some(s => s.key === 'NEW') && w.transitions.every(t => w.statuses.some(s => s.key === t.from) && w.statuses.some(s => s.key === t.to)));

export const pageChecklistSchema = z.object({ revision: z.number().int().nonnegative(), index: z.number().int().min(0).max(9999), checked: z.boolean() }).strict();
