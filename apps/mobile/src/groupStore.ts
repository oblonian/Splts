import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { newId } from '@splts/core';
import { fromBase64, toBase64 } from './base64';

/**
 * There is no trustworthy public relay to default to (the Yjs community
 * relay was retired), so the app remembers the last relay you used and the
 * README has a one-click "Deploy to Render" button for your own free relay.
 */
export const RELAY_PLACEHOLDER = 'wss://your-relay.onrender.com';

const LAST_RELAY_KEY = 'splts:lastRelay';

export async function getLastRelay(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_RELAY_KEY).catch(() => null);
}

export async function setLastRelay(url: string): Promise<void> {
  await AsyncStorage.setItem(LAST_RELAY_KEY, url).catch(() => {});
}

/** Point an existing ledger at a different relay (e.g. after the old one died). */
export async function updateGroupRelay(groupId: string, relayUrl: string): Promise<void> {
  const groups = await listGroups();
  const next = groups.map((g) => (g.id === groupId ? { ...g, relayUrl } : g));
  await saveGroups(next);
}

/** Resolves true if a websocket to `url` opens within `timeoutMs`. */
export function probeRelay(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        resolve(ok);
      }
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${normalizeRelayUrl(url)}/splts-probe`);
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => done(false), timeoutMs);
    ws.onopen = () => { clearTimeout(timer); done(true); };
    ws.onerror = () => { clearTimeout(timer); done(false); };
  });
}

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

/**
 * People paste relay addresses as they see them in a browser (https://…);
 * websockets want wss://. Accept either and normalize, so a copy-pasted
 * Render URL just works.
 */
export function normalizeRelayUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(url)) return url.replace(/^https:\/\//i, 'wss://');
  if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, 'ws://');
  return url;
}

export function isValidRelayUrl(input: string): boolean {
  return /^(wss?|https?):\/\/.+/i.test(input.trim());
}

/** Invite code format: <groupId>@<relayUrl> */
export function encodeInvite(ref: GroupRef): string {
  return `${ref.id}@${ref.relayUrl}`;
}

export function decodeInvite(code: string): GroupRef | null {
  const at = code.indexOf('@');
  if (at <= 0) return null;
  const id = code.slice(0, at).trim();
  const relayUrl = normalizeRelayUrl(code.slice(at + 1));
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

  // Older builds could store https:// here; normalize so those ledgers heal.
  const provider = new WebsocketProvider(normalizeRelayUrl(ref.relayUrl), `splts-${ref.id}`, doc, {
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
