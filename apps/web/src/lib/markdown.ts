import { emptyDocument, documentText, type RichDocument, type RichNode } from '@ventilyator/shared';
import { safeLink, validDocument } from '@ventilyator/validation';
function inline(text: string): RichNode[] {
  const result: RichNode[] = []; const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g; let from = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > from) result.push({ type: 'text', text: text.slice(from, match.index) });
    const value = match[0];
    if (value.startsWith('**')) result.push({ type: 'text', text: value.slice(2, -2), marks: [{ type: 'bold' }] });
    else if (value.startsWith('`')) result.push({ type: 'text', text: value.slice(1, -1), marks: [{ type: 'code' }] });
    else { const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value)!; result.push(safeLink(link[2]) ? { type: 'text', text: link[1], marks: [{ type: 'link', attrs: { href: link[2], target: '_self', rel: 'noopener noreferrer nofollow', class: null } }] } : { type: 'text', text: value }); }
    from = match.index! + value.length;
  }
  if (from < text.length) result.push({ type: 'text', text: text.slice(from) });
  return result;
}
export function importMarkdown(text: string): RichDocument {
  if (text.length > 500000) throw new Error('Для импорта выберите Markdown до 500 КБ');
  const content: RichNode[] = []; const lines = text.replaceAll('\r\n', '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!; if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(); const code: string[] = [];
      while (++index < lines.length && !lines[index]!.startsWith('```')) code.push(lines[index]!);
      content.push({ type: 'codeBlock', attrs: { language: /^[a-z0-9+#_.-]{0,40}$/i.test(language) ? language || null : null }, content: code.length ? [{ type: 'text', text: code.join('\n') }] : [] }); continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { content.push({ type: 'heading', attrs: { level: heading[1]!.length }, content: inline(heading[2]!) }); continue; }
    if (/^([-*_])\1\1+$/.test(line.trim())) { content.push({ type: 'horizontalRule' }); continue; }
    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line), bullet = /^\s*[-*]\s+(.+)$/.exec(line), ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (task || bullet || ordered) {
      const kind = task ? 'taskList' : ordered ? 'orderedList' : 'bulletList'; let list = content.at(-1);
      if (list?.type !== kind) { list = { type: kind, content: [] }; content.push(list); }
      list.content!.push({ type: task ? 'taskItem' : 'listItem', ...(task ? { attrs: { checked: task[1]!.toLowerCase() === 'x' } } : {}), content: [{ type: 'paragraph', content: inline(task?.[2] ?? ordered?.[1] ?? bullet![1]!) }] }); continue;
    }
    if (line.startsWith('> ')) { content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inline(line.slice(2)) }] }); continue; }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]!)) {
      const rows: RichNode[] = []; const parse = (value: string, header: boolean): RichNode => ({ type: 'tableRow', content: value.trim().replace(/^\||\|$/g, '').split('|').slice(0, 20).map(cell => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: inline(cell.trim()) }] })) });
      rows.push(parse(line, true)); index++;
      while (index + 1 < lines.length && lines[index + 1]!.includes('|') && rows.length < 1000) rows.push(parse(lines[++index]!, false));
      content.push({ type: 'table', content: rows }); continue;
    }
    content.push({ type: 'paragraph', content: inline(line) });
  }
  const document: RichDocument = content.length ? { type: 'doc', content } : structuredClone(emptyDocument);
  if (!validDocument(document)) throw new Error('Документ слишком большой или содержит неподдерживаемую структуру');
  return document;
}
export function tableMarkdown(node: RichNode): string {
  const rows = (node.content ?? []).map(row => (row.content ?? []).map(cell => documentText(cell).trim().replaceAll('|', '\\|').replaceAll('\n', ' ')));
  if (!rows.length) return '';
  return '\n' + ['| ' + rows[0]!.join(' | ') + ' |', '| ' + rows[0]!.map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(row => '| ' + row.join(' | ') + ' |')].join('\n') + '\n\n';
}
