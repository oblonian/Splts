import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { initGroupDoc, readMeta, upsertMember } from '@splts/core';
import type { Identity } from '../identity';
import {
  addGroupRef,
  decodeInvite,
  DEFAULT_RELAY_URL,
  listGroups,
  newGroupRef,
  openGroup,
  type GroupRef,
} from '../groupStore';
import { colors, styles } from '../theme';

interface GroupRow {
  ref: GroupRef;
  name: string;
}

export function GroupListScreen({
  identity,
  onOpenGroup,
}: {
  identity: Identity;
  onOpenGroup: (ref: GroupRef) => void;
}) {
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [mode, setMode] = useState<'list' | 'create' | 'join'>('list');

  const refresh = useCallback(async () => {
    const refs = await listGroups();
    const loaded: GroupRow[] = [];
    for (const ref of refs) {
      // Read the locally persisted doc for the group name; no network needed.
      const group = await openGroup(ref);
      loaded.push({ ref, name: readMeta(group.doc).name });
      group.close();
    }
    setRows(loaded);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createGroup = async (name: string, relayUrl: string) => {
    const ref = newGroupRef(relayUrl);
    const group = await openGroup(ref);
    initGroupDoc(group.doc, { name, currency: 'USD' }, { id: identity.id, name: identity.name });
    group.close();
    await addGroupRef(ref);
    await refresh();
    setMode('list');
    onOpenGroup(ref);
  };

  const joinGroup = async (code: string) => {
    const ref = decodeInvite(code);
    if (!ref) {
      Alert.alert('Invalid invite', 'Expected format: <group-id>@<relay-url>');
      return;
    }
    // Register ourselves as a member; syncs once the relay is reachable.
    const group = await openGroup(ref);
    upsertMember(group.doc, { id: identity.id, name: identity.name });
    group.close();
    await addGroupRef(ref);
    await refresh();
    setMode('list');
    onOpenGroup(ref);
  };

  if (mode === 'create') {
    return <CreateGroupForm onSubmit={createGroup} onCancel={() => setMode('list')} />;
  }
  if (mode === 'join') {
    return <JoinGroupForm onSubmit={joinGroup} onCancel={() => setMode('list')} />;
  }

  return (
    <View style={[styles.container, { flex: 1 }]}>
      <Text style={styles.title}>Your groups</Text>
      <Text style={styles.subtitle}>Hi {identity.name} 👋</Text>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.ref.id}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        ListEmptyComponent={
          <Text style={styles.mutedText}>No groups yet. Create one or join with an invite code.</Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => onOpenGroup(item.ref)}>
            <Text style={styles.listItemTitle}>{item.name}</Text>
            <Text style={styles.mutedText}>relay: {item.ref.relayUrl}</Text>
          </Pressable>
        )}
      />
      <Pressable style={styles.button} onPress={() => setMode('create')}>
        <Text style={styles.buttonText}>Create group</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={() => setMode('join')}>
        <Text style={styles.buttonSecondaryText}>Join with invite code</Text>
      </Pressable>
    </View>
  );
}

function CreateGroupForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, relayUrl: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>New group</Text>
      <TextInput
        style={styles.input}
        placeholder="Group name (e.g. Goa trip)"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <Text style={styles.mutedText}>
        Relay server — the “dumb pipe” your group syncs through. Anyone in the
        group can host it, or use any public relay.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="ws://your-relay:4444"
        placeholderTextColor={colors.muted}
        value={relayUrl}
        onChangeText={setRelayUrl}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={[styles.button, !name.trim() && { opacity: 0.5 }]}
        disabled={!name.trim()}
        onPress={() => onSubmit(name.trim(), relayUrl.trim())}
      >
        <Text style={styles.buttonText}>Create</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={onCancel}>
        <Text style={styles.buttonSecondaryText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function JoinGroupForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (code: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join group</Text>
      <Text style={styles.mutedText}>
        Paste the invite code someone shared with you (group-id@relay-url).
      </Text>
      <TextInput
        style={styles.input}
        placeholder="a1b2c3...@ws://relay:4444"
        placeholderTextColor={colors.muted}
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      <Pressable
        style={[styles.button, !code.trim() && { opacity: 0.5 }]}
        disabled={!code.trim()}
        onPress={() => onSubmit(code.trim())}
      >
        <Text style={styles.buttonText}>Join</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={onCancel}>
        <Text style={styles.buttonSecondaryText}>Cancel</Text>
      </Pressable>
    </View>
  );
}
