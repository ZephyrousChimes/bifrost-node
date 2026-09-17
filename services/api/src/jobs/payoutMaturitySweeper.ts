import { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/transaction";
import { postLedgerTransaction } from "../ledger/ledger.repository";
import { OutboxRepository } from "../outbox/outbox.repository";

const BATCH_SIZE = 200;

interface DueGroup {
  merchant_id: number;
  currency: string;
  due_amount: number; // sum of matured, unswept capture credits for this merchant/currency
  entry_ids: number[];
}

// Moves captured funds from `pending` to `available` once they've matured -- see
// openapi/bifrost.v1.yaml#getBalance: "the maturity sweep between them is an auditable balanced
// transaction rather than an invisible UPDATE."
//
// Sweeping is done per merchant/currency against the *current* pending balance, not by blindly
// moving each matured entry's original captured amount. The naive per-entry version of this
// (move exactly what each entry says, independently) is wrong whenever a refund lands on the
// same money between capture and maturity: the refund already debited `pending` for its share,
// so re-crediting `available` with the full original capture amount double-counts the refunded
// portion and drives `pending` negative for no real reason. Capping the swept amount at
// min(sum of due entries, current pending balance) makes the sweep agree with what a refund (or
// anything else touching pending in the meantime) already did.
export async function sweepMaturedPayouts(pool: Pool, outboxRepository: OutboxRepository): Promise<number> {
  let sweptCount = 0;

  await withTransaction(pool, async (client: PoolClient) => {
    const dueRows = await client.query<{ merchant_id: number; currency: string; entry_id: number; amount: number }>(
      `SELECT a.merchant_id, e.currency, e.id AS entry_id, e.amount
       FROM ledger_entries e
       JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.type = 'merchant_payable_pending'
         AND e.direction = 'credit'
         AND e.matures_at IS NOT NULL
         AND e.matures_at <= now()
         AND e.swept_at IS NULL
       ORDER BY e.matures_at ASC
       LIMIT $1
       FOR UPDATE OF e SKIP LOCKED`,
      [BATCH_SIZE],
    );

    const groups = new Map<string, DueGroup>();
    for (const row of dueRows.rows) {
      const key = `${row.merchant_id}:${row.currency}`;
      const group = groups.get(key) ?? { merchant_id: row.merchant_id, currency: row.currency, due_amount: 0, entry_ids: [] };
      group.due_amount += row.amount;
      group.entry_ids.push(row.entry_id);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const balanceResult = await client.query<{ pending: number }>(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS pending
         FROM ledger_entries e
         JOIN ledger_accounts a ON a.id = e.account_id
         WHERE a.merchant_id = $1 AND a.type = 'merchant_payable_pending' AND e.currency = $2`,
        [group.merchant_id, group.currency],
      );
      const currentPending = balanceResult.rows[0]?.pending ?? 0;

      // Mark every candidate entry swept regardless of whether it produces a transfer, so a
      // fully-refunded capture's entry isn't reconsidered by every future sweep forever.
      await client.query(`UPDATE ledger_entries SET swept_at = now() WHERE id = ANY($1::bigint[])`, [group.entry_ids]);

      const sweepAmount = Math.max(0, Math.min(group.due_amount, currentPending));
      if (sweepAmount === 0) {
        sweptCount += group.entry_ids.length;
        continue;
      }

      await postLedgerTransaction(client, [
        {
          accountType: "merchant_payable_pending",
          merchantId: group.merchant_id,
          direction: "debit",
          amount: sweepAmount,
          currency: group.currency,
        },
        {
          accountType: "merchant_payable_available",
          merchantId: group.merchant_id,
          direction: "credit",
          amount: sweepAmount,
          currency: group.currency,
        },
      ]);

      await outboxRepository.append(
        group.merchant_id,
        "payout.paid",
        { object: "payout", amount: sweepAmount, currency: group.currency },
        client,
      );
      sweptCount += group.entry_ids.length;
    }
  });

  return sweptCount;
}

export function startPayoutMaturitySweeper(pool: Pool, outboxRepository: OutboxRepository, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    sweepMaturedPayouts(pool, outboxRepository).catch((err) => console.error("payout maturity sweeper error", err));
  }, intervalMs);
}
