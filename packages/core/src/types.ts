/**
 * All money is stored in minor units (cents, paise, ...) as integers.
 * Floating point never touches a balance.
 */

export type MemberId = string;
export type EventId = string;

export interface Member {
  id: MemberId;
  name: string;
  /** Device public key, reserved for signed events / E2EE (roadmap). */
  publicKey?: string;
}

export interface GroupMeta {
  name: string;
  /** ISO 4217 code, e.g. "USD", "INR". One currency per group in v0. */
  currency: string;
}

/**
 * The ledger is an append-only log of events. Balances are never stored;
 * they are recomputed from the log, which is what makes concurrent offline
 * edits merge cleanly.
 */
export type LedgerEvent = ExpenseAdded | ExpenseVoided | PaymentRecorded;

export interface ExpenseAdded {
  type: 'expense-added';
  id: EventId;
  description: string;
  /** Total amount in minor units. */
  amount: number;
  paidBy: MemberId;
  /** Exact share owed per member, in minor units. Shares sum to `amount`. */
  split: Record<MemberId, number>;
  createdBy: MemberId;
  createdAt: number;
}

/** Soft delete: the log is append-only, so removal is itself an event. */
export interface ExpenseVoided {
  type: 'expense-voided';
  id: EventId;
  /** The ExpenseAdded event being voided. */
  target: EventId;
  createdBy: MemberId;
  createdAt: number;
}

/** A settlement: `from` handed real money to `to` outside the app. */
export interface PaymentRecorded {
  type: 'payment-recorded';
  id: EventId;
  from: MemberId;
  to: MemberId;
  amount: number;
  createdBy: MemberId;
  createdAt: number;
}

/** memberId -> net balance in minor units. Positive = is owed, negative = owes. */
export type Balances = Record<MemberId, number>;

export interface Transfer {
  from: MemberId;
  to: MemberId;
  amount: number;
}
