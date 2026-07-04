import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { computeBalances, equalSplit } from '../src/ledger.ts';
import {
  appendEvent,
  initGroupDoc,
  newId,
  readEvents,
  readMembers,
  readMeta,
  upsertMember,
} from '../src/groupDoc.ts';

/** Simulate sync by exchanging Yjs updates both ways. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('group doc', () => {
  it('initializes meta and creator', () => {
    const doc = new Y.Doc();
    initGroupDoc(doc, { name: 'Trip', currency: 'EUR' }, { id: 'alice', name: 'Alice' });
    expect(readMeta(doc)).toEqual({ name: 'Trip', currency: 'EUR', kind: 'group' });
    expect(readMembers(doc)).toEqual([{ id: 'alice', name: 'Alice' }]);
  });

  it('merges concurrent offline edits from two devices without losing either', () => {
    // Device A creates the group, device B joins via sync.
    const a = new Y.Doc();
    initGroupDoc(a, { name: 'Flat', currency: 'USD' }, { id: 'alice', name: 'Alice' });
    const b = new Y.Doc();
    sync(a, b);
    upsertMember(b, { id: 'bob', name: 'Bob' });
    sync(a, b);

    // Both go offline and each records an expense.
    appendEvent(a, {
      type: 'expense-added',
      id: newId(),
      description: 'groceries',
      amount: 2000,
      paidBy: 'alice',
      split: equalSplit(2000, ['alice', 'bob']),
      createdBy: 'alice',
      createdAt: 1,
    });
    appendEvent(b, {
      type: 'expense-added',
      id: newId(),
      description: 'internet',
      amount: 1000,
      paidBy: 'bob',
      split: equalSplit(1000, ['alice', 'bob']),
      createdBy: 'bob',
      createdAt: 2,
    });

    // Back online: both devices converge to the same ledger and balances.
    sync(a, b);
    const eventsA = readEvents(a);
    const eventsB = readEvents(b);
    expect(eventsA).toEqual(eventsB);
    expect(eventsA).toHaveLength(2);

    const balances = computeBalances(eventsA);
    // alice paid 2000, owes 1000+500; bob paid 1000, owes 1000+500.
    expect(balances).toEqual({ alice: 500, bob: -500 });
    expect(computeBalances(eventsB)).toEqual(balances);
  });

  it('newId produces unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});
