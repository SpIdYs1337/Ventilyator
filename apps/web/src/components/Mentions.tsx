import { Node as TiptapNode } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { commentMentionPattern, type MentionPerson } from '@ventilyator/shared';
import { api } from '../lib/api';
import { ErrorMessage } from './common';

const emptyPeople: MentionPerson[] = [];

export const MentionNode = TiptapNode.create({
  name: 'mention', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ id: { default: null }, label: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-type="mention"]', getAttrs: element => ({ id: element.getAttribute('data-id'), label: element.getAttribute('data-label') ?? element.textContent?.replace(/^@/, '') }) }],
  renderHTML: ({ node }) => ['span', { 'data-type': 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label, class: 'user-mention' }, `@${node.attrs.label}`],
  renderText: ({ node }) => `@${node.attrs.label}`,
});

export function MentionPicker({ url, query, choose, dismiss, position }: { url: string; query: string; choose: (person: MentionPerson) => void; dismiss: () => void; position?: { left: number; top: number } }) {
  const people = useQuery({ queryKey: ['mention-people', url, query], queryFn: () => api<MentionPerson[]>(`${url}?q=${encodeURIComponent(query)}`) });
  const [selected, setSelected] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const items = people.data ?? emptyPeople, active = Math.min(selected, Math.max(0, items.length - 1));
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!menu.current?.parentElement?.contains(event.target as globalThis.Node)) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
      if (items.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') choose(items[active]!);
        else setSelected((active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [items, active, choose, dismiss]);
  return <div ref={menu} className="mention-menu" style={position} role="listbox" aria-label="Сотрудники для упоминания">{people.isLoading && <p>Поиск сотрудников…</p>}{people.isError && <ErrorMessage error={people.error} />}{items.map((person, index) => <button type="button" role="option" aria-selected={active === index} key={person.id} onMouseDown={event => event.preventDefault()} onClick={() => choose(person)}><strong>{person.name}</strong><small>{person.email}</small></button>)}{!people.isLoading && !people.isError && !items.length && <p>Нет подходящих сотрудников с доступом к пространству.</p>}</div>;
}
export function MentionTextarea({ label, value, onChange, url }: { label: string; value: string; onChange: (value: string) => void; url: string }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<{ from: number; to: number; query: string } | null>(null);
  return <div className="mention-input"><label>{label}<textarea ref={input} rows={3} required maxLength={10000} value={value} placeholder="Введите @ для упоминания сотрудника" onBlur={() => setRange(null)} onChange={event => { const text = event.target.value, to = event.target.selectionStart; onChange(text); const match = /(?:^|\s)@([^\s@]{0,60})$/.exec(text.slice(0, to)); setRange(match ? { from: to - match[1]!.length - 1, to, query: match[1]! } : null); }} /></label>{range && <MentionPicker key={range.query} url={url} query={range.query} dismiss={() => setRange(null)} choose={person => { const tag = `@${person.email} `; onChange(value.slice(0, range.from) + tag + value.slice(range.to)); setRange(null); input.current?.focus(); requestAnimationFrame(() => input.current?.setSelectionRange(range.from + tag.length, range.from + tag.length)); }} />}</div>;
}
export function MentionText({ body }: { body: string }) {
  const parts = []; let from = 0;
  for (const match of body.matchAll(commentMentionPattern())) { parts.push(body.slice(from, match.index)); parts.push(<span className="user-mention" key={match.index}>{match[0]}</span>); from = match.index! + match[0].length; }
  parts.push(body.slice(from)); return <>{parts}</>;
}
