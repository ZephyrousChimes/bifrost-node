import { randomUUID } from "node:crypto";
import { Queryable } from "../db/types";

export type LedgerAccountType =
  | "acquirer_receivable"
  | "platform_fee_revenue"
  | "merchant_payable_pending"
  | "merchant_payable_available";

export interface LedgerEntryInput {
  accountType: LedgerAccountType;
  merchantId: number | null; // null for the two platform accounts
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  paymentId?: number;
  chargeId?: number;
  refundId?: number;
  maturesAt?: Date; // only meaningful on a merchant_payable_pending credit
}

// Looks up a ledger account, creating it if this is the merchant's first transaction to touch
// it. Platform accounts are seeded by the migration and never created here.
async function resolveAccountId(executor: Queryable, merchantId: number | null, type: LedgerAccountType, currency: string): Promise<number> {
  const existing = await executor.query<{ id: number }>(
    `SELECT id FROM ledger_accounts WHERE type = $1 AND currency = $2 AND merchant_id IS NOT DISTINCT FROM $3`,
    [type, currency, merchantId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  if (merchantId === null) {
    throw new Error(`platform ledger account ${type}/${currency} is missing — should have been seeded by migration`);
  }

  // ON CONFLICT DO NOTHING + re-select rather than DO UPDATE ... RETURNING: simpler than
  // matching the partial unique index's predicate in the conflict target, and a lost race here
  // just means the loser re-selects the winner's row.
  await executor.query(
    `INSERT INTO ledger_accounts (merchant_id, type, currency) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [merchantId, type, currency],
  );
  const resolved = await executor.query<{ id: number }>(
    `SELECT id FROM ledger_accounts WHERE type = $1 AND currency = $2 AND merchant_id = $3`,
    [type, currency, merchantId],
  );
  return resolved.rows[0].id;
}

// Writes a balanced set of ledger entries as one transaction. Must be called inside a
// withTransaction() block together with whatever status change the entries describe (a
// capture, a refund, a maturity sweep) — the deferred trigger only rejects an imbalance at
// COMMIT, so entries and the state change they justify either land together or not at all.
export async function postLedgerTransaction(executor: Queryable, entries: LedgerEntryInput[]): Promise<string> {
  const ledgerTransactionId = randomUUID();

  for (const entry of entries) {
    const accountId = await resolveAccountId(executor, entry.merchantId, entry.accountType, entry.currency);
    await executor.query(
      `INSERT INTO ledger_entries
         (ledger_transaction_id, account_id, direction, amount, currency, payment_id, charge_id, refund_id, matures_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        ledgerTransactionId,
        accountId,
        entry.direction,
        entry.amount,
        entry.currency,
        entry.paymentId ?? null,
        entry.chargeId ?? null,
        entry.refundId ?? null,
        entry.maturesAt ?? null,
      ],
    );
  }

  return ledgerTransactionId;
}

export interface MerchantBalanceRow {
  currency: string;
  pending: number;
  available: number;
}

// Balance is never stored — it's the sum of ledger entries, recomputed on every read. That's
// the whole point of double-entry: the balance is a derived fact, not a mutable counter that
// could drift from what the entries actually say.
export async function computeMerchantBalance(executor: Queryable, merchantId: number): Promise<MerchantBalanceRow[]> {
  const result = await executor.query<MerchantBalanceRow>(
    `SELECT
       a.currency,
       COALESCE(SUM(CASE WHEN a.type = 'merchant_payable_pending'
                          THEN (CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END)
                          ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN a.type = 'merchant_payable_available'
                          THEN (CASE WHEN e.direction = 'credit' THEN e.amount ELSE -e.amount END)
                          ELSE 0 END), 0) AS available
     FROM ledger_accounts a
     LEFT JOIN ledger_entries e ON e.account_id = a.id
     WHERE a.merchant_id = $1
     GROUP BY a.currency`,
    [merchantId],
  );
  return result.rows;
}
