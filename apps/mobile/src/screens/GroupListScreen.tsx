import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { getMeta, initGroupDoc, upsertMember, type GroupMeta } from '@splts/core';
import type { Identity } from '../identity';
import {
  addGroupRef,
  decodeInvite,
  getLastRelay,
  listGroups,
  loadGroupSnapshot,
  isValidRelayUrl,
  newGroupRef,
  normalizeRelayUrl,
  openGroup,
  probeRelay,
  RELAY_PLACEHOLDER,
  setLastRelay,
  type GroupRef,
} from '../groupStore';
import { colors, styles } from '../theme';
import { Banner, Field, GhostButton, PrimaryButton } from '../ui';
import { useBackHandler } from '../useBackHandler';

const CURRENCIES = ['USD', 'EUR', 'INR', 'GBP', 'JPY', 'AUD', 'CAD', 'BRL'];

interface GroupRow {
  ref: GroupRef;
  name: string;
  kind: 'group' | 'friend';
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
  const [lastRelay, setLastRelayState] = useState<string | null>(null);

  useEffect(() => {
    getLastRelay().then(setLastRelayState);
  }, [mode]);

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
            const meta = getMeta(doc);
            const name = meta.get('name') ?? 'Waiting for first sync…';
            const kind = meta.get('kind') === 'friend' ? 'friend' as const : 'group' as const;
            doc.destroy();
            return { ref, name, kind };
          } catch {
            return { ref, name: 'Unreadable group', kind: 'group', broken: true };
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

  const createGroup = async (meta: GroupMeta, relayUrl: string) => {
    try {
      const ref = newGroupRef(relayUrl);
      const group = await openGroup(ref);
      initGroupDoc(group.doc, meta, { id: identity.id, name: identity.name });
      await group.close();
      await addGroupRef(ref);
      await setLastRelay(relayUrl);
      await refresh();
      setMode('list');
      onOpenGroup(ref);
    } catch {
      setError("Couldn't create it. Check device storage and try again.");
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
      await setLastRelay(ref.relayUrl);
      await refresh();
      setMode('list');
      onOpenGroup(ref);
      return null;
    } catch {
      return "Couldn't join. Check the invite code and try again.";
    }
  };

  if (mode === 'create') {
    return (
      <CreateForm
        initialRelay={lastRelay ?? ''}
        onSubmit={createGroup}
        onCancel={() => setMode('list')}
      />
    );
  }
  if (mode === 'join') {
    return <JoinGroupForm onSubmit={joinGroup} onCancel={() => setMode('list')} />;
  }

  const friends = (rows ?? []).filter((r) => r.kind === 'friend');
  const groups = (rows ?? []).filter((r) => r.kind !== 'friend');

  const renderRow = (item: GroupRow) => (
    <Pressable
      key={item.ref.id}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
      onPress={() => !item.broken && onOpenGroup(item.ref)}
    >
      <Text style={styles.listItemTitle}>
        {item.kind === 'friend' ? '👤 ' : '👥 '}
        {item.name}
      </Text>
      {item.broken && <Text style={styles.mutedText}>Local data unreadable</Text>}
    </Pressable>
  );

  return (
    <View style={[styles.container, { flex: 1 }]}>
      <Text style={styles.title}>Splts</Text>
      <Text style={styles.subtitle}>Hi {identity.name} 👋</Text>
      {error && <Banner text={error} />}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
        {rows !== null && rows.length === 0 && (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={styles.listItemTitle}>Nothing here yet</Text>
            <Text style={[styles.mutedText, { textAlign: 'center' }]}>
              Start a 1-on-1 ledger with a friend, create a group for a trip or
              household, or join with an invite code.
            </Text>
          </View>
        )}
        {friends.length > 0 && <Text style={styles.sectionTitle}>Friends</Text>}
        {friends.map(renderRow)}
        {groups.length > 0 && <Text style={styles.sectionTitle}>Groups</Text>}
        {groups.map(renderRow)}
      </ScrollView>
      <PrimaryButton label="New friend or group" onPress={() => setMode('create')} />
      <GhostButton label="Join with invite code" onPress={() => setMode('join')} />
    </View>
  );
}

function CreateForm({
  initialRelay,
  onSubmit,
  onCancel,
}: {
  initialRelay: string;
  onSubmit: (meta: GroupMeta, relayUrl: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<'friend' | 'group'>('friend');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [customCurrency, setCustomCurrency] = useState('');
  const [relayUrl, setRelayUrl] = useState(initialRelay);
  // No relay remembered yet: show the sync-server section so the user sets one.
  const [advanced, setAdvanced] = useState(initialRelay.length === 0);
  const [submitting, setSubmitting] = useState(false);

  const chosenCurrency = (customCurrency.trim() || currency).toUpperCase();
  const valid = name.trim().length > 0 && /^[A-Z]{3}$/.test(chosenCurrency) && isValidRelayUrl(relayUrl);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>New</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['friend', '👤 Friend (1-on-1)'],
            ['group', '👥 Group'],
          ] as const
        ).map(([k, label]) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[
              styles.buttonSecondary,
              { flex: 1 },
              kind === k && { backgroundColor: colors.primary },
            ]}
          >
            <Text style={[styles.buttonSecondaryText, kind === k && { color: '#fff' }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Field
        placeholder={kind === 'friend' ? "Friend's name (e.g. Rahul)" : 'Group name (e.g. Goa trip)'}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <Text style={styles.mutedText}>Currency</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CURRENCIES.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              setCurrency(c);
              setCustomCurrency('');
            }}
            style={[
              styles.buttonSecondary,
              { paddingHorizontal: 12, paddingVertical: 8 },
              chosenCurrency === c && { backgroundColor: colors.primary },
            ]}
          >
            <Text style={[styles.buttonSecondaryText, chosenCurrency === c && { color: '#fff' }]}>
              {c}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field
        placeholder="Other (3-letter code, e.g. CHF)"
        value={customCurrency}
        onChangeText={setCustomCurrency}
        autoCapitalize="characters"
        maxLength={3}
      />
      <View style={styles.row}>
        <Text style={styles.mutedText}>Advanced: choose sync server</Text>
        <Switch value={advanced} onValueChange={setAdvanced} trackColor={{ true: colors.primary }} />
      </View>
      {advanced && (
        <>
          <Text style={styles.mutedText}>
            The relay is the “dumb pipe” you sync through — it works anywhere
            with internet. The default is a free public relay; self-host
            packages/relay for full privacy.
          </Text>
          <Field
            placeholder={RELAY_PLACEHOLDER}
            value={relayUrl}
            onChangeText={setRelayUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </>
      )}
      <PrimaryButton
        label={submitting ? 'Creating…' : kind === 'friend' ? 'Start ledger' : 'Create group'}
        disabled={!valid || submitting}
        onPress={async () => {
          setSubmitting(true);
          const url = normalizeRelayUrl(relayUrl);
          const reachable = await probeRelay(url);
          if (!reachable) {
            setSubmitting(false);
            Alert.alert(
              "Can't reach that sync server",
              'You can still create the ledger — it will sync once the server is reachable. See the README for a one-click free relay.',
              [
                { text: 'Fix the URL', style: 'cancel' },
                {
                  text: 'Create anyway',
                  onPress: () => {
                    setSubmitting(true);
                    onSubmit({ name: name.trim(), currency: chosenCurrency, kind }, url);
                  },
                },
              ],
            );
            return;
          }
          onSubmit({ name: name.trim(), currency: chosenCurrency, kind }, url);
        }}
      />
      <GhostButton label="Cancel" onPress={onCancel} />
    </ScrollView>
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
      <Text style={styles.title}>Join</Text>
      <Text style={styles.mutedText}>
        Paste the invite code someone shared with you.
      </Text>
      {error && <Banner text={error} />}
      <Field
        placeholder="a1b2c3…@wss://relay"
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
