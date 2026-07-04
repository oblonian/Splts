import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import {
  activeExpenses,
  appendEvent,
  computeBalances,
  equalSplit,
  formatAmount,
  newId,
  parseAmount,
  readEvents,
  readMembers,
  readMeta,
  settleUp,
  type Member,
} from '@splts/core';
import type { Identity } from '../identity';
import {
  encodeInvite,
  openGroup,
  RELAY_PLACEHOLDER,
  setLastRelay,
  updateGroupRelay,
  type GroupRef,
  type OpenGroup,
} from '../groupStore';
import { colors, styles } from '../theme';
import { Banner, Field, GhostButton, PrimaryButton } from '../ui';
import { useBackHandler } from '../useBackHandler';

export function GroupScreen({
  groupRef,
  identity,
  onBack,
}: {
  groupRef: GroupRef;
  identity: Identity;
  onBack: () => void;
}) {
  const [group, setGroup] = useState<OpenGroup | null>(null);
  const [openError, setOpenError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [connected, setConnected] = useState(false);
  // Bumped on every doc change to re-render from the latest CRDT state.
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editingRelay, setEditingRelay] = useState(false);
  const [relayDraft, setRelayDraft] = useState(groupRef.relayUrl);

  useBackHandler(adding || editingRelay, () => {
    setAdding(false);
    setEditingRelay(false);
  });

  useEffect(() => {
    let active = true;
    let opened: OpenGroup | null = null;
    openGroup(groupRef, { onPersistError: () => setSaveError(true) })
      .then((g) => {
        if (!active) {
          g.close();
          return;
        }
        opened = g;
        g.doc.on('update', () => setVersion((v) => v + 1));
        // The provider may have connected during the storage read, before
        // this listener existed — seed from its current state.
        setConnected(g.provider.wsconnected);
        g.provider.on('status', ({ status }: { status: string }) =>
          setConnected(status === 'connected'),
        );
        setGroup(g);
      })
      .catch(() => {
        if (active) setOpenError(true);
      });
    return () => {
      active = false;
      opened?.close();
    };
  }, [groupRef]);

  const append = useCallback(
    (event: Parameters<typeof appendEvent>[1]) => {
      // The confirm dialog (or a slow tap) can outlive this screen; writing
      // to a destroyed doc would silently drop the event.
      if (!group || group.doc.isDestroyed) return;
      appendEvent(group.doc, event);
    },
    [group],
  );

  const state = useMemo(() => {
    if (!group) return null;
    const events = readEvents(group.doc);
    const balances = computeBalances(events);
    return {
      meta: readMeta(group.doc),
      members: readMembers(group.doc),
      expenses: activeExpenses(events),
      balances,
      transfers: settleUp(balances),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, version]);

  if (openError) {
    return (
      <View style={[styles.container, { flex: 1, justifyContent: 'center' }]}>
        <Banner text="Couldn't open this group — its local data may be damaged." />
        <GhostButton label="← Back to groups" onPress={onBack} />
      </View>
    );
  }

  if (!group || !state) {
    return (
      <View style={[styles.container, { flex: 1 }]}>
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← Groups</Text>
        </Pressable>
        <Text style={styles.mutedText}>Opening group…</Text>
      </View>
    );
  }

  const { meta, members, expenses, balances, transfers } = state;
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? 'unknown';
  const myBalance = balances[identity.id] ?? 0;

  const voidExpense = (targetId: string) => {
    Alert.alert('Delete expense?', 'It will be removed for everyone in the group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          append({
            type: 'expense-voided',
            id: newId(),
            target: targetId,
            createdBy: identity.id,
            createdAt: Date.now(),
          }),
      },
    ]);
  };

  const shareInvite = () => {
    Share.share({ message: `Join "${meta.name}" on Splts: ${encodeInvite(groupRef)}` }).catch(
      () => {},
    );
  };

  if (adding) {
    return (
      <AddExpenseForm
        members={members}
        identity={identity}
        currency={meta.currency}
        onSubmit={(description, amount, paidBy) => {
          append({
            type: 'expense-added',
            id: newId(),
            description,
            amount,
            paidBy,
            split: equalSplit(
              amount,
              members.map((m) => m.id),
            ),
            createdBy: identity.id,
            createdAt: Date.now(),
          });
          setAdding(false);
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.row}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.link}>← Groups</Text>
        </Pressable>
        <Text style={connected ? { color: colors.positive } : { color: colors.muted }}>
          {connected ? '● synced' : '○ offline (saved locally)'}
        </Text>
      </View>

      <Text style={styles.title}>{meta.kind === 'friend' ? `👤 ${meta.name}` : meta.name}</Text>
      <Text style={styles.subtitle}>
        {meta.kind === 'friend'
          ? `1-on-1 ledger · ${meta.currency}`
          : `${members.length} member${members.length === 1 ? '' : 's'} · ${meta.currency}`}
      </Text>
      {meta.kind === 'friend' && members.length === 1 && (
        <Banner
          kind="info"
          text={`Waiting for ${meta.name} to join — send them the invite below.`}
        />
      )}

      {saveError && (
        <Banner text="Couldn't save changes to this device — free up storage. Synced copies are unaffected." />
      )}

      {!connected && !editingRelay && (
        <Pressable onPress={() => setEditingRelay(true)} hitSlop={8}>
          <Text style={[styles.mutedText, { textDecorationLine: 'underline' }]}>
            Not syncing? Change the sync server
          </Text>
        </Pressable>
      )}
      {editingRelay && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sync server for this ledger</Text>
          <Text style={styles.mutedText}>
            Everyone in this ledger must use the same server — re-share the
            invite after changing it. Deploy a free one via the README.
          </Text>
          <Field
            placeholder={RELAY_PLACEHOLDER}
            value={relayDraft}
            onChangeText={setRelayDraft}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <PrimaryButton
            label="Save & reconnect"
            disabled={!/^wss?:\/\/.+/.test(relayDraft.trim())}
            onPress={async () => {
              const url = relayDraft.trim();
              await updateGroupRelay(groupRef.id, url);
              await setLastRelay(url);
              setEditingRelay(false);
              Alert.alert('Saved', 'Reopen this ledger to connect to the new server.', [
                { text: 'OK', onPress: onBack },
              ]);
            }}
          />
          <GhostButton label="Cancel" onPress={() => setEditingRelay(false)} />
        </View>
      )}

      <View style={[styles.card, { alignItems: 'center', paddingVertical: 18 }]}>
        {myBalance === 0 ? (
          <Text style={styles.listItemTitle}>You're all settled up 🎉</Text>
        ) : (
          <>
            <Text style={styles.mutedText}>{myBalance > 0 ? "You're owed" : 'You owe'}</Text>
            <Text
              style={[
                { fontSize: 32, fontWeight: '700' },
                myBalance > 0 ? { color: colors.positive } : { color: colors.negative },
              ]}
            >
              {formatAmount(Math.abs(myBalance))} {meta.currency}
            </Text>
          </>
        )}
      </View>

      <PrimaryButton label="Add expense" onPress={() => setAdding(true)} />
      <GhostButton
        label={meta.kind === 'friend' ? `Invite ${meta.name}` : 'Invite someone'}
        onPress={shareInvite}
      />

      {members.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Balances</Text>
          {members.map((m) => {
            const balance = balances[m.id] ?? 0;
            return (
              <View key={m.id} style={styles.row}>
                <Text>{m.id === identity.id ? `${m.name} (you)` : m.name}</Text>
                <Text style={balance >= 0 ? styles.amountPositive : styles.amountNegative}>
                  {balance >= 0 ? '+' : ''}
                  {formatAmount(balance)}
                </Text>
              </View>
            );
          })}
          {transfers.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Suggested settle-up</Text>
              {transfers.map((t, i) => (
                <View key={i} style={styles.row}>
                  <Text style={styles.mutedText}>
                    {memberName(t.from)} → {memberName(t.to)}: {formatAmount(t.amount)}
                  </Text>
                  {t.from === identity.id && (
                    <Pressable
                      hitSlop={8}
                      onPress={() =>
                        append({
                          type: 'payment-recorded',
                          id: newId(),
                          from: t.from,
                          to: t.to,
                          amount: t.amount,
                          createdBy: identity.id,
                          createdAt: Date.now(),
                        })
                      }
                    >
                      <Text style={styles.link}>I paid this</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Expenses</Text>
      {expenses.length === 0 && (
        <Text style={styles.mutedText}>
          Nothing yet — add the first expense and it'll be split with the group.
        </Text>
      )}
      {expenses.map((e) => (
        <View key={e.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.listItemTitle}>{e.description}</Text>
            <Text style={styles.listItemTitle}>{formatAmount(e.amount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.mutedText}>
              paid by {e.paidBy === identity.id ? 'you' : memberName(e.paidBy)} · split{' '}
              {Object.keys(e.split).length} ways
            </Text>
            <Pressable onPress={() => voidExpense(e.id)} hitSlop={8}>
              <Text style={{ color: colors.danger }}>delete</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function AddExpenseForm({
  members,
  identity,
  currency,
  onSubmit,
  onCancel,
}: {
  members: Member[];
  identity: Identity;
  currency: string;
  onSubmit: (description: string, amount: number, paidBy: string) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [paidBy, setPaidBy] = useState(identity.id);
  const amount = parseAmount(amountText);
  const valid = description.trim().length > 0 && amount !== null && members.length > 0;
  const perHead = amount !== null && members.length > 0 ? Math.round(amount / members.length) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Add expense</Text>
      <Field
        placeholder="What was it? (e.g. Dinner)"
        value={description}
        onChangeText={setDescription}
        autoFocus
      />
      <Field
        placeholder="Amount (e.g. 42.50)"
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
      />
      <Text style={styles.mutedText}>Paid by</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {members.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setPaidBy(m.id)}
            style={[
              styles.buttonSecondary,
              { paddingHorizontal: 12, paddingVertical: 8 },
              paidBy === m.id && { backgroundColor: colors.primary },
            ]}
          >
            <Text style={[styles.buttonSecondaryText, paidBy === m.id && { color: '#fff' }]}>
              {m.id === identity.id ? `${m.name} (you)` : m.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.mutedText}>
        {perHead !== null
          ? `Split equally: ≈ ${formatAmount(perHead)} ${currency} each (${members.length} members)`
          : `Split equally among all ${members.length} members.`}
      </Text>
      <PrimaryButton
        label="Add"
        disabled={!valid}
        onPress={() => valid && onSubmit(description.trim(), amount!, paidBy)}
      />
      <GhostButton label="Cancel" onPress={onCancel} />
    </ScrollView>
  );
}
