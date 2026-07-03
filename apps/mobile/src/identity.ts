import AsyncStorage from '@react-native-async-storage/async-storage';
import { newId } from '@splts/core';

const KEY = 'splts:identity';

export interface Identity {
  id: string;
  name: string;
}

/**
 * Device-local identity: a random id plus a display name. There is no
 * account and no server that knows who you are. Roadmap: replace the random
 * id with a keypair so events can be signed and docs end-to-end encrypted.
 *
 * Throws on storage failure — callers must NOT treat a transient read error
 * as "no identity", or onboarding would mint a new id over the one all the
 * user's balances are keyed to.
 */
export async function loadIdentity(): Promise<Identity | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Identity>;
    if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // corrupt value: fall through to null (a fresh identity is the only option)
  }
  return null;
}

export async function createIdentity(name: string): Promise<Identity> {
  const identity: Identity = { id: newId(), name: name.trim() };
  await AsyncStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}
