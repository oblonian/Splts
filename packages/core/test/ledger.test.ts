import { describe, expect, it } from 'vitest';
import {
  activeExpenses,
  computeBalances,
  equalSplit,
  formatAmount,
  parseAmount,
  settleUp,
} from '../src/ledger.ts';
import type { LedgerEvent } from '../src/types.ts';

const expense = (
  id: string,
  amount: number,
  paidBy: string,
  split: Record<string, number>,
): LedgerEvent => ({
  type: 'expense-added',
  id,
  description: id,
  amount,
  paidBy,
  split,
  createdBy: paidBy,
  createdAt: 0,
});

describe('equalSplit', () => {
  it('splits evenly when divisible', () => {
    expect(equalSplit(3000, ['a', 'b', 'c'])).toEqual({ a: 1000, b: 1000, c: 1000 });
  });

  it('distributes remainder cents deterministically', () => {
    const split = equalSplit(1000, ['a', 'b', 'c']);
    expect(split).toEqual({ a: 334, b: 333, c: 333 });
    expect(split.a! + split.b! + split.c!).toBe(1000);
  });

  it('rejects non-integer and non-positive amounts', () => {
    expect(() => equalSplit(10.5, ['a'])).toThrow();
    expect(() => equalSplit(0, ['a'])).toThrow();
    expect(() => equalSplit(100, [])).toThrow();
  });
});

describe('computeBalances', () => {
  it('nets a simple shared expense', () => {
    const events = [expense('e1', 3000, 'alice', { alice: 1000, bob: 1000, carol: 1000 })];
    expect(computeBalances(events)).toEqual({ alice: 2000, bob: -1000, carol: -1000 });
  });

  it('applies payments as settlements', () => {
    const events: LedgerEvent[] = [
      expense('e1', 2000, 'alice', { alice: 1000, bob: 1000 }),
      { type: 'payment-recorded', id: 'p1', from: 'bob', to: 'alice', amount: 1000, createdBy: 'bob', createdAt: 1 },
    ];
    expect(computeBalances(events)).toEqual({ alice: 0, bob: 0 });
  });

  it('excludes voided expenses regardless of event order', () => {
    const add = expense('e1', 2000, 'alice', { alice: 1000, bob: 1000 });
    const voidIt: LedgerEvent = { type: 'expense-voided', id: 'v1', target: 'e1', createdBy: 'alice', createdAt: 2 };
    expect(computeBalances([add, voidIt])).toEqual({});
    expect(computeBalances([voidIt, add])).toEqual({});
  });

  it('is order-independent, as required for CRDT merges', () => {
    const events: LedgerEvent[] = [
      expense('e1', 3000, 'alice', { alice: 1000, bob: 1000, carol: 1000 }),
      expense('e2', 900, 'bob', { alice: 300, bob: 300, carol: 300 }),
      { type: 'payment-recorded', id: 'p1', from: 'carol', to: 'alice', amount: 500, createdBy: 'carol', createdAt: 3 },
    ];
    const reversed = [...events].reverse();
    expect(computeBalances(events)).toEqual(computeBalances(reversed));
  });

  it('always sums to zero', () => {
    const events: LedgerEvent[] = [
      expense('e1', 1000, 'alice', { alice: 334, bob: 333, carol: 333 }),
      expense('e2', 555, 'bob', { bob: 278, carol: 277 }),
    ];
    const total = Object.values(computeBalances(events)).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });
});

describe('activeExpenses', () => {
  it('excludes voided expenses and sorts newest first, matching computeBalances semantics', () => {
    const e1 = { ...expense('e1', 1000, 'a', { a: 1000 }), createdAt: 1 };
    const e2 = { ...expense('e2', 2000, 'a', { a: 2000 }), createdAt: 2 };
    const voidE1: LedgerEvent = { type: 'expense-voided', id: 'v1', target: 'e1', createdBy: 'a', createdAt: 3 };
    expect(activeExpenses([voidE1, e1, e2])).toEqual([e2]);
    expect(computeBalances([voidE1, e1, e2])).toEqual({ a: 0 });
  });
});

describe('settleUp', () => {
  it('settles a three-way debt with minimal transfers', () => {
    const transfers = settleUp({ alice: 2000, bob: -1000, carol: -1000 });
    expect(transfers).toEqual([
      { from: 'bob', to: 'alice', amount: 1000 },
      { from: 'carol', to: 'alice', amount: 1000 },
    ]);
  });

  it('chains debts through the largest creditor', () => {
    const transfers = settleUp({ a: 500, b: 250, c: -750 });
    expect(transfers).toEqual([
      { from: 'c', to: 'a', amount: 500 },
      { from: 'c', to: 'b', amount: 250 },
    ]);
  });

  it('returns nothing when everyone is settled', () => {
    expect(settleUp({ a: 0, b: 0 })).toEqual([]);
  });

  it('is deterministic across devices (tie-break by id)', () => {
    const balances = { zed: -500, amy: -500, pat: 1000 };
    expect(settleUp(balances)).toEqual([
      { from: 'amy', to: 'pat', amount: 500 },
      { from: 'zed', to: 'pat', amount: 500 },
    ]);
  });
});

describe('amount formatting', () => {
  it('round-trips', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(formatAmount(1234)).toBe('12.34');
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('12.3')).toBe(1230);
    expect(formatAmount(-50)).toBe('-0.50');
  });

  it('rejects junk', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1,000')).toBeNull();
    expect(parseAmount('0')).toBeNull();
  });
});
