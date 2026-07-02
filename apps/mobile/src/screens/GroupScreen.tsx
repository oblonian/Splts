import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import {
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
  type LedgerEvent,
  type Member,
} from '@splts/core';
import type { Identity } from '../identity';
import { encodeInvite, openGroup, type GroupRef, type OpenGroup } from '../groupStore';
import { colors, styles } from '../theme';

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
  const [connected, setConnected] = useState(false);
  // Bumped on every doc change to re-render from the latest CRDT state.
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    let opened: OpenGroup | null = null;
    openGroup(groupRef).then((g) => {
      if (!active) {
        g.close();
        return;
      }
      opened = g;
      g.doc.on('update', () => setVersion((v) => v + 1));
      g.provider.on('status', ({ status }: { status: string }) =>
        setConnected(status === 'connected'),
      );
      setGroup(g);
    });
    return () => {
      active = false;
      opened?.close();
    };
  }, [groupRef]);

  const state = useMemo(() => {
    if (!group) return null;
    const events = readEvents(group.doc);
    return {
      meta: readMeta(group.doc),
      members: readMembers(group.doc),
      events,
      balances: computeBalances(events),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, version]);

  if (!group || !state) {
    return (
      <View style={[styles.container, { flex: 1 }]}>
        <Text style={styles.mutedText}>Opening group…</Text>
      </View>
    );
  }

  const { meta, members, events, balances } = state;
  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? 'unknown';
  const expenses = events
    .filter((e): e is Extract<LedgerEvent, { type: 'expense-added' }> => e.type === 'expense-added')
    .filter((e) => !events.some((v) => v.type === 'expense-voided' && v.target === e.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const transfers = settleUp(balances);

  const voidExpense = (targetId: string) => {
    Alert.alert('Delete expense?', 'It will be removed for everyone in the group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          appendEvent(group.doc, {
            type: 'expense-voided',
            id: newId(),
            target: targetId,
            createdBy: identity.id,
            createdAt: Date.now(),
          }),
      },
    ]);
  };

  const recordPayment = (from: string, to: string, amount: number) => {
    appendEvent(group.doc, {
      type: 'payment-recorded',
      id: newId(),
      from,
      to,
      amount,
      createdBy: identity.id,
      createdAt: Date.now(),
    });
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
        onSubmit={(description, amount, paidBy) => {
          appendEvent(group.doc, {
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
        <Pressable onPress={onBack}>
          <Text style={styles.link}>← Groups</Text>
        </Pressable>
        <Text style={connected ? { color: colors.positive } : { color: colors.muted }}>
          {connected ? '● synced' : '○ offline (saved locally)'}
        </Text>
      </View>

      <Text style={styles.title}>{meta.name}</Text>
      <Text style={styles.subtitle}>
        {members.length} member{members.length === 1 ? '' : 's'} · {meta.currency}
      </Text>

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
            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Settle up</Text>
            {transfers.map((t, i) => (
              <View key={i} style={styles.row}>
                <Text style={styles.mutedText}>
                  {memberName(t.from)} → {memberName(t.to)}: {formatAmount(t.amount)}
                </Text>
                {t.from === identity.id && (
                  <Pressable onPress={() => recordPayment(t.from, t.to, t.amount)}>
                    <Text style={styles.link}>I paid this</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </View>

      <Pressable style={styles.button} onPress={() => setAdding(true)}>
        <Text style={styles.buttonText}>Add expense</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={shareInvite}>
        <Text style={styles.buttonSecondaryText}>Invite someone</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Expenses</Text>
      {expenses.length === 0 && <Text style={styles.mutedText}>Nothing yet.</Text>}
      {expenses.map((e) => (
        <View key={e.id} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.listItemTitle}>{e.description}</Text>
            <Text style={styles.listItemTitle}>{formatAmount(e.amount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.mutedText}>
              paid by {memberName(e.paidBy)} · split {Object.keys(e.split).length} ways
            </Text>
            <Pressable onPress={() => voidExpense(e.id)}>
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
  onSubmit,
  onCancel,
}: {
  members: Member[];
  identity: Identity;
  onSubmit: (description: string, amount: number, paidBy: string) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState('');
  const [amountText, setAmountText] = useState('');
  const [paidBy, setPaidBy] = useState(identity.id);
  const amount = parseAmount(amountText);
  const valid = description.trim().length > 0 && amount !== null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add expense</Text>
      <TextInput
        style={styles.input}
        placeholder="What was it? (e.g. Dinner)"
        placeholderTextColor={colors.muted}
        value={description}
        onChangeText={setDescription}
        autoFocus
      />
      <TextInput
        style={styles.input}
        placeholder="Amount (e.g. 42.50)"
        placeholderTextColor={colors.muted}
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
            <Text
              style={[styles.buttonSecondaryText, paidBy === m.id && { color: '#fff' }]}
            >
              {m.id === identity.id ? `${m.name} (you)` : m.name}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.mutedText}>Split equally among all {members.length} members.</Text>
      <Pressable
        style={[styles.button, !valid && { opacity: 0.5 }]}
        disabled={!valid}
        onPress={() => valid && onSubmit(description.trim(), amount!, paidBy)}
      >
        <Text style={styles.buttonText}>Add</Text>
      </Pressable>
      <Pressable style={styles.buttonSecondary} onPress={onCancel}>
        <Text style={styles.buttonSecondaryText}>Cancel</Text>
      </Pressable>
    </View>
  );
}
