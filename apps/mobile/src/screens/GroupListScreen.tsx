import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';
import { getMeta, initGroupDoc, upsertMember } from '@splts/core';
import type { Identity } from '../identity';
import {
  addGroupRef,
  decodeInvite,
  DEFAULT_RELAY_URL,
  listGroups,
  loadGroupSnapshot,
  newGroupRef,
  openGroup,
  type GroupRef,
} from '../groupStore';
import { colors, styles } from '../theme';
import { Banner, Field, GhostButton, PrimaryButton } from '../ui';
import { useBackHandler } from '../useBackHandler';

interface GroupRow {
  ref: GroupRef;
  name: string;
  broken?: boolean;
}

export function GroupListScreen({
  identity,
  onOpenGroup,
}: {
  identity: Identity;
  onOpenGroup: (ref: GroupRef) => void;
}) {
  const [rows, setRows] = useState<GroupRow[] | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'join'>('list');
  const [error, setError] = useState<string | null>(null);

  useBackHandler(mode !== 'list', () => setMode('list'));

  const refresh = useCallback(async () => {
    try {
      const refs = await listGroups();
      // Storage-only reads: no relay connections just to render names, and
      // one broken group must not blank the whole list.
      const loaded = await Promise.all(
        refs.map(async (ref): Promise<GroupRow> => {
          try {
            const doc = await loadGroupSnapshot(ref);
            const name = getMeta(doc).get('name') ?? 'Waiting for first sync…';
            doc.destroy();
            return { ref, name };
          } catch {
            return { ref, name: 'Unreadable group', broken: true };
          }
        }),
      );
      setRows(loaded);
      setError(null);
    } catch {
      setRows([]);
      setError("Couldn't load your groups from device storage.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createGroup = async (name: string, relayUrl: string) => {
    try {
      const ref = newGroupRef(relayUrl);
      const group = await openGroup(ref);
      initGroupDoc(group.doc, { name, currency: 'USD' }, { id: identity.id, name: identity.name });
      await group.close();
      await addGroupRef(ref);
      await refresh();
      setMode('list');
      onOpenGroup(ref);
    } catch {
      setError("Couldn't create the group. Check device storage and try again.");
      setMode('list');
    }
  };

  const joinGroup = async (code: string): Promise<string | null> => {
    const ref = decodeInvite(code);
    if (!ref) return 'That invite code doesn’t look right. Expected: <group-id>@<relay-url>';
    try {
      // Register ourselves as a member; syncs once the relay is reachable.
      const group = await openGroup(ref);
      upsertMember(group.doc, { id: identity.id, name: identity.name });
      await group.close();
      await addGroupRef(ref);
      await refresh();
      setMode('list');
      onOpenGroup(ref);
      return null;
    } catch {
      return "Couldn't join. Check the invite code and try again.";
    }
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
      {error && <Banner text={error} />}
      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row.ref.id}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        ListEmptyComponent={
          rows === null ? null : (
            <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
              <Text style={styles.listItemTitle}>No groups yet</Text>
              <Text style={[styles.mutedText, { textAlign: 'center' }]}>
                Create a group for your trip or household, or join one with an
                invite code a friend shared.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
            onPress={() => !item.broken && onOpenGroup(item.ref)}
          >
            <Text style={styles.listItemTitle}>{item.name}</Text>
            <Text style={styles.mutedText}>
              {item.broken ? 'Local data unreadable' : relayHost(item.ref.relayUrl)}
            </Text>
          </Pressable>
        )}
      />
      <PrimaryButton label="Create group" onPress={() => setMode('create')} />
      <GhostButton label="Join with invite code" onPress={() => setMode('join')} />
    </View>
  );
}

function relayHost(url: string): string {
  return url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
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
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>New group</Text>
      <Field
        placeholder="Group name (e.g. Goa trip)"
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <View style={styles.row}>
        <Text style={styles.mutedText}>Advanced: choose sync server</Text>
        <Switch
          value={advanced}
          onValueChange={setAdvanced}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {advanced && (
        <>
          <Text style={styles.mutedText}>
            The relay is the “dumb pipe” your group syncs through. Anyone in
            the group can host one — it never sees your balances.
          </Text>
          <Field
            placeholder="ws://your-relay:4444"
            value={relayUrl}
            onChangeText={setRelayUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}
      <PrimaryButton
        label={submitting ? 'Creating…' : 'Create'}
        disabled={!name.trim() || !relayUrl.trim() || submitting}
        onPress={() => {
          setSubmitting(true);
          onSubmit(name.trim(), relayUrl.trim());
        }}
      />
      <GhostButton label="Cancel" onPress={onCancel} />
    </View>
  );
}

function JoinGroupForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (code: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join group</Text>
      <Text style={styles.mutedText}>
        Paste the invite code someone shared with you.
      </Text>
      {error && <Banner text={error} />}
      <Field
        placeholder="a1b2c3…@ws://relay:4444"
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      <PrimaryButton
        label={submitting ? 'Joining…' : 'Join'}
        disabled={!code.trim() || submitting}
        onPress={async () => {
          setSubmitting(true);
          const err = await onSubmit(code.trim());
          setSubmitting(false);
          setError(err);
        }}
      />
      <GhostButton label="Cancel" onPress={onCancel} />
    </View>
  );
}
