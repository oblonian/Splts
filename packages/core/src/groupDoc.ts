import * as Y from 'yjs';
import type { GroupMeta, LedgerEvent, Member } from './types.ts';

/**
 * A group is a single Y.Doc with three top-level shared types:
 *
 *   meta    Y.Map<string>          group name, currency
 *   members Y.Map<Member>          keyed by member id (map, so renames merge)
 *   events  Y.Array<LedgerEvent>   append-only ledger
 *
 * Events are plain JSON objects appended to a Y.Array. Appends from different
 * devices always merge (both survive, in some order); balances are replayed
 * from the log, so order between concurrent events does not matter.
 */

export const META_KEY = 'meta';
export const MEMBERS_KEY = 'members';
export const EVENTS_KEY = 'events';

export function getMeta(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>(META_KEY);
}

export function getMembersMap(doc: Y.Doc): Y.Map<Member> {
  return doc.getMap<Member>(MEMBERS_KEY);
}

export function getEventsArray(doc: Y.Doc): Y.Array<LedgerEvent> {
  return doc.getArray<LedgerEvent>(EVENTS_KEY);
}

export function initGroupDoc(doc: Y.Doc, meta: GroupMeta, creator: Member): void {
  doc.transact(() => {
    const m = getMeta(doc);
    m.set('name', meta.name);
    m.set('currency', meta.currency);
    m.set('kind', meta.kind ?? 'group');
    getMembersMap(doc).set(creator.id, creator);
  });
}

export function readMeta(doc: Y.Doc): GroupMeta {
  const m = getMeta(doc);
  return {
    name: m.get('name') ?? 'Unnamed group',
    currency: m.get('currency') ?? 'USD',
    kind: m.get('kind') === 'friend' ? 'friend' : 'group',
  };
}

export function readMembers(doc: Y.Doc): Member[] {
  const members: Member[] = [];
  getMembersMap(doc).forEach((m) => members.push(m));
  return members.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function readEvents(doc: Y.Doc): LedgerEvent[] {
  return getEventsArray(doc).toArray();
}

export function upsertMember(doc: Y.Doc, member: Member): void {
  getMembersMap(doc).set(member.id, member);
}

export function appendEvent(doc: Y.Doc, event: LedgerEvent): void {
  getEventsArray(doc).push([event]);
}

/** Random id, collision-safe enough for event/member ids without coordination. */
export function newId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
