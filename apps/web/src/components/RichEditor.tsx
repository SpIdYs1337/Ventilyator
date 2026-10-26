import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { Button } from '@ventilyator/ui';
import type { RichDocument, RichNode } from '@ventilyator/shared';
import { safeLink } from '@ventilyator/validation';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { MentionNode, MentionPicker } from './Mentions';
import { tableMarkdown } from '../lib/markdown';

const extensions = [MentionNode, StarterKit.configure({ link: { openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow' } } }), Table.configure({ resizable: false }), TableRow, TableCell, TableHeader, TaskList, TaskItem.configure({ nested: true }), Image.configure({ allowBase64: false }), Highlight.configure({ multicolor: true }), TextStyle, Color];
export function RichEditor({ content, editable, onChange, insertImage, anchorPrefix, label, mentionUrl, onChecklistChange, checklistPending }: { content: RichDocument; editable: boolean; onChange?: (value: RichDocument) => void; insertImage?: { src: string; sequence: number }; anchorPrefix?: string; label?: string; mentionUrl?: string; onChecklistChange?: (index: number, checked: boolean) => void; checklistPending?: boolean }) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<{ from: number; to: number; query: string; left: number; top: number } | null>(null);
  const updateMention = (editor: Editor) => {
    if (!editable || !mentionUrl) return;
    const { $from, from, to } = editor.state.selection;
    const match = from === to && $from.parent.isTextblock ? /(?:^|\s)@([^\s@]{0,60})$/.exec($from.parent.textBetween(0, $from.parentOffset, '\0', '\0')) : null;
    if (!match) { setMention(null); return; }
    const coords = editor.view.coordsAtPos(from), bounds = root.current?.getBoundingClientRect();
    setMention({ from: from - match[1]!.length - 1, to, query: match[1]!, left: Math.max(0, Math.min(coords.left - (bounds?.left ?? coords.left), (bounds?.width ?? 320) - 300)), top: coords.bottom - (bounds?.top ?? 0) + 6 });
  };
  const readonlyTasks = TaskItem.configure({ nested: true, a11y: { checkboxLabel: node => `Пункт чек-листа: ${node.textContent || 'без названия'}` }, onReadOnlyChecked: (node, checked) => {
    if (!onChecklistChange || checklistPending) return false;
    let index = 0, target = -1;
    editor?.state.doc.descendants(current => { if (current.type.name === 'taskItem') { if (current === node) target = index; index++; } });
    if (target >= 0) onChecklistChange(target, checked);
    return false;
  } });
  const editor = useEditor({ extensions: extensions.map(extension => extension.name === 'taskItem' ? readonlyTasks : extension), content, editable, shouldRerenderOnTransaction: true, onUpdate: ({ editor }) => { onChange?.(editor.getJSON() as RichDocument); updateMention(editor); }, onSelectionUpdate: ({ editor }) => updateMention(editor), onBlur: () => setMention(null), editorProps: { attributes: { class: 'rich-document', role: 'textbox', 'aria-label': label ?? (editable ? 'Содержимое страницы' : 'Опубликованная страница'), 'aria-multiline': 'true' } } });
  useEffect(() => { if (editor && insertImage) { editor.view.focus(); editor.chain().setImage({ src: insertImage.src }).run(); } }, [editor, insertImage]);
  useEffect(() => { if (editor && anchorPrefix) editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading, index) => { heading.id = `${anchorPrefix}-heading-${index}`; }); }, [editor, anchorPrefix, content]);
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);
  useEffect(() => { editor?.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(checkbox => { checkbox.disabled = Boolean(!editable && (!onChecklistChange || checklistPending)); }); }, [editor, editable, onChecklistChange, checklistPending, content]);
  if (!editor) return null;
  // Mobile DOM focus can change ProseMirror state synchronously. Focus before
  // creating a transaction so formatting never dispatches a stale transaction.
  const focused = () => { editor.view.focus(); return editor.chain(); };
  return <div ref={root} className={editable ? 'rich-editor editing' : 'rich-editor'}>{editable && <div className="editor-toolbar" role="toolbar" aria-label="Форматирование"><select aria-label="Стиль текста" value={editor.isActive('heading') ? String(editor.getAttributes('heading').level) : '0'} onChange={e => { const level = Number(e.target.value); if (!level) focused().setParagraph().run(); else focused().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run(); }}><option value="0">Обычный текст</option>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>Заголовок {n}</option>)}</select><Button type="button" variant="ghost" aria-label="Жирный" aria-pressed={editor.isActive('bold')} onClick={() => focused().toggleBold().run()}><strong>B</strong></Button><Button type="button" variant="ghost" aria-label="Курсив" aria-pressed={editor.isActive('italic')} onClick={() => focused().toggleItalic().run()}><em>I</em></Button><Button type="button" variant="ghost" aria-label="Подчёркнутый" aria-pressed={editor.isActive('underline')} onClick={() => focused().toggleUnderline().run()}><u>U</u></Button><Button type="button" variant="ghost" aria-label="Зачёркнутый" onClick={() => focused().toggleStrike().run()}><s>S</s></Button><Button type="button" variant="ghost" onClick={() => focused().toggleBulletList().run()}>• Список</Button><Button type="button" variant="ghost" onClick={() => focused().toggleOrderedList().run()}>1. Список</Button><Button type="button" variant="ghost" onClick={() => focused().toggleTaskList().run()}>☑ Чек-лист</Button><Button type="button" variant="ghost" onClick={() => focused().toggleBlockquote().run()}>Цитата</Button><Button type="button" variant="ghost" onClick={() => focused().toggleCodeBlock().run()}>Код</Button><Button type="button" variant="ghost" onClick={() => focused().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Таблица</Button>{editor.isActive('table') && <><Button type="button" variant="ghost" onClick={() => focused().addRowAfter().run()}>+ Строка</Button><Button type="button" variant="ghost" onClick={() => focused().addColumnAfter().run()}>+ Столбец</Button><Button type="button" variant="ghost" onClick={() => focused().deleteTable().run()}>Удалить таблицу</Button></>}<Button type="button" variant="ghost" onClick={() => focused().toggleHighlight().run()}>Маркер</Button><label className="editor-color">Цвет<input type="color" aria-label="Цвет текста" defaultValue="#202d28" onChange={e => focused().setColor(e.target.value).run()} /></label><Button type="button" variant="ghost" onClick={() => focused().insertContent(' @').run()}>@ Сотрудник</Button><Button type="button" variant="ghost" onClick={() => { const href = window.prompt('Адрес ссылки', editor.getAttributes('link').href as string ?? 'https://'); if (href === '') focused().unsetLink().run(); else if (href && safeLink(href)) focused().setLink({ href, target: '_self' }).run(); }}>Ссылка</Button><Button type="button" variant="ghost" aria-label="Отменить изменение" disabled={!editor.can().undo()} onClick={() => focused().undo().run()}>↶</Button><Button type="button" variant="ghost" aria-label="Повторить изменение" disabled={!editor.can().redo()} onClick={() => focused().redo().run()}>↷</Button></div>}{mention && mentionUrl && <MentionPicker key={mention.query} url={mentionUrl} query={mention.query} position={{ left: mention.left, top: mention.top }} dismiss={() => setMention(null)} choose={person => { editor.view.focus(); editor.chain().insertContentAt({ from: mention.from, to: mention.to }, [{ type: 'mention', attrs: { id: person.id, label: person.name } }, { type: 'text', text: ' ' }]).run(); setMention(null); }} />}<div onClickCapture={event => { const anchor = (event.target as HTMLElement).closest('a'); if (!anchor || editable || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; const href = anchor.getAttribute('href'); if (!href || !safeLink(href)) return; event.preventDefault(); event.stopPropagation(); const target = new URL(href, window.location.href); if (target.origin === window.location.origin) { if (target.pathname === location.pathname && target.hash) { document.getElementById(decodeURIComponent(target.hash.slice(1)))?.scrollIntoView(); } else navigate(target.pathname + target.search + target.hash); } else window.location.assign(target.href); }}><EditorContent editor={editor} /></div></div>;
}

export function toMarkdown(node: RichNode, depth = 0): string {
  if (node.type === 'table') return tableMarkdown(node);
  const text = (node.content ?? []).map(child => toMarkdown(child, depth + 1)).join('');
  if (node.type === 'mention') return `@${String(node.attrs?.label ?? '')}`;
  if (node.type === 'text') {
    let value = (node.text ?? '').replace(/([\\`*_[\]<>])/g, '\\$1');
    for (const mark of node.marks ?? []) { if (mark.type === 'bold') value = `**${value}**`; if (mark.type === 'italic') value = `*${value}*`; if (mark.type === 'code') value = `\`${value}\``; if (mark.type === 'link' && typeof mark.attrs?.href === 'string') value = `[${value}](${mark.attrs.href.replace(/[()]/g, '')})`; }
    return value;
  }
  if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${text}\n\n`;
  if (node.type === 'paragraph') return `${text}\n\n`;
  if (node.type === 'listItem') return `- ${text.trim()}\n`;
  if (node.type === 'taskItem') return `- [${node.attrs?.checked ? 'x' : ' '}] ${text.trim()}\n`;
  if (node.type === 'codeBlock') return `\`\`\`\n${text}\n\`\`\`\n\n`;
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'horizontalRule') return '\n---\n';
  if (node.type === 'blockquote') return `> ${text.trim().replaceAll('\n', '\n> ')}\n\n`;
  return text;
}
export { downloadText } from '../lib/download';
