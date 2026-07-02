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
 */
export async function loadIdentity(): Promise<Identity | null> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Identity) : null;
}

export async function createIdentity(name: string): Promise<Identity> {
  const identity: Identity = { id: newId(), name: name.trim() };
  await AsyncStorage.setItem(KEY, JSON.stringify(identity));
  return identity;
}
