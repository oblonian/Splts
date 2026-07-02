import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { newId } from '@splts/core';
import { fromBase64, toBase64 } from './base64';

export const DEFAULT_RELAY_URL = 'ws://localhost:4444';

const INDEX_KEY = 'splts:groups';
const docKey = (groupId: string) => `splts:doc:${groupId}`;

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
  await AsyncStorage.removeItem(docKey(groupId));
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
  if (!/^[0-9a-f]{32}$/.test(id) || !/^wss?:\/\//.test(relayUrl)) return null;
  return { id, relayUrl };
}

export interface OpenGroup {
  doc: Y.Doc;
  provider: WebsocketProvider;
  close: () => void;
}

/**
 * Open a group: hydrate the Y.Doc from local storage (offline-first), start
 * syncing through the relay, and persist every change back to storage
 * (debounced). The device's local copy is the source of truth; the relay is
 * just transport.
 */
export async function openGroup(ref: GroupRef): Promise<OpenGroup> {
  const doc = new Y.Doc();

  const persisted = await AsyncStorage.getItem(docKey(ref.id));
  if (persisted) Y.applyUpdate(doc, fromBase64(persisted));

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      AsyncStorage.setItem(docKey(ref.id), toBase64(Y.encodeStateAsUpdate(doc))).catch(() => {});
    }, 500);
  };
  doc.on('update', persist);

  const provider = new WebsocketProvider(ref.relayUrl, `splts-${ref.id}`, doc, {
    disableBc: true,
  });

  return {
    doc,
    provider,
    close: () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        AsyncStorage.setItem(docKey(ref.id), toBase64(Y.encodeStateAsUpdate(doc))).catch(() => {});
      }
      provider.destroy();
      doc.destroy();
    },
  };
}
