import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { newId } from '@splts/core';
import { fromBase64, toBase64 } from './base64';

/**
 * Default: the public Yjs community relay, so groups sync over the internet
 * with zero setup. Room names are unguessable 128-bit ids, but the relay can
 * read CRDT bytes it forwards (E2EE is on the roadmap) — self-host
 * packages/relay and set your own URL under Advanced for private infra.
 */
export const DEFAULT_RELAY_URL = 'wss://demos.yjs.dev/ws';

const INDEX_KEY = 'splts:groups';
const docKey = (groupId: string) => `splts:doc:${groupId}`;
const chunkKey = (groupId: string, i: number) => `splts:doc:${groupId}:${i}`;

// Android's AsyncStorage reads rows through a ~2 MB CursorWindow; a single
// huge value becomes unreadable. Store the doc as chunks well under that.
const CHUNK_CHARS = 250_000;

export interface GroupRef {
  /** Doubles as the sync room name. Knowing the id = membership (v0). */
  id: string;
  relayUrl: string;
}

export async function listGroups(): Promise<GroupRef[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  return raw ? (JSON.parse(raw) as GroupRef[]) : [];
}

async function saveGroups(groups: GroupRef[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(groups));
}

export async function addGroupRef(ref: GroupRef): Promise<void> {
  const groups = await listGroups();
  if (!groups.some((g) => g.id === ref.id)) {
    groups.push(ref);
    await saveGroups(groups);
  }
}

export async function removeGroupRef(groupId: string): Promise<void> {
  await saveGroups((await listGroups()).filter((g) => g.id !== groupId));
  const meta = await AsyncStorage.getItem(docKey(groupId)).catch(() => null);
  const keys = [docKey(groupId)];
  const chunkCount = parseChunkCount(meta);
  for (let i = 0; i < chunkCount; i++) keys.push(chunkKey(groupId, i));
  await AsyncStorage.multiRemove(keys).catch(() => {});
}

export function newGroupRef(relayUrl: string): GroupRef {
  return { id: newId(), relayUrl };
}

/** Invite code format: <groupId>@<relayUrl> */
export function encodeInvite(ref: GroupRef): string {
  return `${ref.id}@${ref.relayUrl}`;
}

export function decodeInvite(code: string): GroupRef | null {
  const at = code.indexOf('@');
  if (at <= 0) return null;
  const id = code.slice(0, at).trim();
  const relayUrl = code.slice(at + 1).trim();
  if (!/^[0-9a-f]{32}$/.test(id) || !/^wss?:\/\/.+/.test(relayUrl)) return null;
  return { id, relayUrl };
}

function parseChunkCount(metaValue: string | null): number {
  if (!metaValue || !metaValue.startsWith('{')) return 0;
  try {
    const parsed = JSON.parse(metaValue) as { chunks?: number };
    return typeof parsed.chunks === 'number' && parsed.chunks >= 0 ? parsed.chunks : 0;
  } catch {
    return 0;
  }
}

/** Hydrate a doc from local storage. Handles both chunked and legacy formats. */
async function loadDocInto(doc: Y.Doc, groupId: string): Promise<void> {
  const meta = await AsyncStorage.getItem(docKey(groupId));
  if (!meta) return;
  let b64: string;
  if (meta.startsWith('{')) {
    const count = parseChunkCount(meta);
    if (count === 0) return;
    const keys = Array.from({ length: count }, (_, i) => chunkKey(groupId, i));
    const rows = await AsyncStorage.multiGet(keys);
    b64 = rows.map(([, v]) => v ?? '').join('');
  } else {
    // Legacy single-key format from v0 builds.
    b64 = meta;
  }
  if (b64) Y.applyUpdate(doc, fromBase64(b64));
}

async function saveDoc(doc: Y.Doc, groupId: string): Promise<void> {
  const b64 = toBase64(Y.encodeStateAsUpdate(doc));
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS));
  const previousCount = parseChunkCount(await AsyncStorage.getItem(docKey(groupId)).catch(() => null));

  const pairs: [string, string][] = chunks.map((c, i) => [chunkKey(groupId, i), c]);
  pairs.push([docKey(groupId), JSON.stringify({ chunks: chunks.length })]);
  await AsyncStorage.multiSet(pairs);

  if (previousCount > chunks.length) {
    const stale: string[] = [];
    for (let i = chunks.length; i < previousCount; i++) stale.push(chunkKey(groupId, i));
    await AsyncStorage.multiRemove(stale).catch(() => {});
  }
}

/**
 * Read a group's doc from local storage only — no relay connection, no
 * listeners. For the group list and anywhere else that just needs a peek.
 */
export async function loadGroupSnapshot(ref: GroupRef): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await loadDocInto(doc, ref.id);
  return doc;
}

export interface OpenGroupOptions {
  /** Called when persisting to local storage fails — surface this, don't hide it. */
  onPersistError?: (error: unknown) => void;
}

export interface OpenGroup {
  doc: Y.Doc;
  provider: WebsocketProvider;
  /** Flushes pending changes to storage, then tears down. Await before re-opening. */
  close: () => Promise<void>;
}

/**
 * Open a group: hydrate the Y.Doc from local storage (offline-first), start
 * syncing through the relay, and persist every change back to storage
 * (debounced). The device's local copy is the source of truth; the relay is
 * just transport.
 */
export async function openGroup(ref: GroupRef, options?: OpenGroupOptions): Promise<OpenGroup> {
  const doc = new Y.Doc();
  await loadDocInto(doc, ref.id);

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastWrite: Promise<void> = Promise.resolve();
  const flush = () => {
    lastWrite = saveDoc(doc, ref.id).catch((err) => options?.onPersistError?.(err));
    return lastWrite;
  };
  const persistSoon = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      flush();
    }, 500);
  };
  doc.on('update', persistSoon);

  const provider = new WebsocketProvider(ref.relayUrl, `splts-${ref.id}`, doc, {
    disableBc: true,
  });

  return {
    doc,
    provider,
    close: async () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        flush();
      }
      await lastWrite;
      provider.destroy();
      doc.destroy();
    },
  };
}
