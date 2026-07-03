import type { Balances, ExpenseAdded, LedgerEvent, MemberId, Transfer } from './types.ts';

/**
 * Split an amount equally among members, distributing remainder cents
 * deterministically (first members in the given order get the extra cent),
 * so every device computes the identical split.
 */
export function equalSplit(amount: number, members: MemberId[]): Record<MemberId, number> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive integer of minor units');
  if (members.length === 0) throw new Error('cannot split among zero members');
  const base = Math.floor(amount / members.length);
  let remainder = amount - base * members.length;
  const split: Record<MemberId, number> = {};
  for (const m of members) {
    split[m] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return split;
}

/** Ids of expenses that have been voided. The single source of void semantics. */
export function voidedIds(events: LedgerEvent[]): Set<string> {
  const voided = new Set<string>();
  for (const e of events) {
    if (e.type === 'expense-voided') voided.add(e.target);
  }
  return voided;
}

/** Expenses that still count, newest first. */
export function activeExpenses(events: LedgerEvent[]): ExpenseAdded[] {
  const voided = voidedIds(events);
  return events
    .filter((e): e is ExpenseAdded => e.type === 'expense-added' && !voided.has(e.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Replay the event log into net balances.
 * Positive balance = the group owes this member; negative = they owe the group.
 * Voided expenses are excluded; a void for an unknown target is ignored
 * (it may arrive before its target during sync — order-independence matters).
 */
export function computeBalances(events: LedgerEvent[]): Balances {
  const voided = voidedIds(events);

  const balances: Balances = {};
  const credit = (m: MemberId, amount: number) => {
    balances[m] = (balances[m] ?? 0) + amount;
  };

  for (const e of events) {
    switch (e.type) {
      case 'expense-added': {
        if (voided.has(e.id)) break;
        credit(e.paidBy, e.amount);
        for (const [member, share] of Object.entries(e.split)) {
          credit(member, -share);
        }
        break;
      }
      case 'payment-recorded': {
        credit(e.from, e.amount);
        credit(e.to, -e.amount);
        break;
      }
      case 'expense-voided':
        break;
    }
  }
  return balances;
}

/**
 * Greedy minimum-cash-flow settlement: repeatedly match the largest debtor
 * with the largest creditor. Produces at most (n - 1) transfers.
 * Ties are broken by member id so the suggestion is identical on every device.
 */
export function settleUp(balances: Balances): Transfer[] {
  const creditors: { id: MemberId; amount: number }[] = [];
  const debtors: { id: MemberId; amount: number }[] = [];
  for (const [id, amount] of Object.entries(balances)) {
    if (amount > 0) creditors.push({ id, amount });
    else if (amount < 0) debtors.push({ id, amount: -amount });
  }
  const byAmountThenId = (a: { id: string; amount: number }, b: { id: string; amount: number }) =>
    b.amount - a.amount || a.id.localeCompare(b.id);
  creditors.sort(byAmountThenId);
  debtors.sort(byAmountThenId);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]!;
    const d = debtors[di]!;
    const amount = Math.min(c.amount, d.amount);
    transfers.push({ from: d.id, to: c.id, amount });
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount === 0) ci++;
    if (d.amount === 0) di++;
  }
  return transfers;
}

/** Format minor units for display, e.g. 1234 -> "12.34". Display-only helper. */
export function formatAmount(minor: number, decimals = 2): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const factor = 10 ** decimals;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(decimals, '0');
  return `${sign}${whole}.${frac}`;
}

/** Parse a user-typed decimal string into minor units. Returns null if invalid. */
export function parseAmount(input: string, decimals = 2): number | null {
  const match = input.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = match[1]!;
  const frac = (match[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  const minor = Number(whole) * 10 ** decimals + Number(frac);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
