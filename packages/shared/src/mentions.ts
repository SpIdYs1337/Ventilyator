import type { RichNode } from './knowledge';
export interface MentionPerson { id: string; name: string; email: string }
export function mentionedUserIds(node: RichNode): string[] {
  const ids = new Set<string>();
  const walk = (value: RichNode) => { if (value.type === 'mention' && typeof value.attrs?.id === 'string') ids.add(value.attrs.id.toLowerCase()); value.content?.forEach(walk); };
  walk(node); return [...ids];
}
export const commentMentionPattern = () => /@([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63})\b/gi;
export function commentMentionEmails(body: string): string[] { return [...new Set([...body.matchAll(commentMentionPattern())].map(match => match[1]!.toLowerCase()))]; }
