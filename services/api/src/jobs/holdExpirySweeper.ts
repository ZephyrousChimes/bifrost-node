import { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/transaction";
import { PaymentRepository } from "../payment/payment.repository";
import { ChargeRepository } from "../payment/charge.repository";
import { OutboxRepository } from "../outbox/outbox.repository";
import { toPaymentView } from "../payment/payment.view";

const BATCH_SIZE = 50;

// A manual-capture authorization that's never captured expires on its own -- see
// openapi/bifrost.v1.yaml#capturePayment: "an uncaptured authorization expires on its own after
// seven days." This is what actually enforces that: it doesn't touch the ledger (nothing was
// ever captured, so there's nothing to reverse), it only releases the hold by moving the
// payment to `canceled` with cancellation_reason 'expired' -- a value only this sweeper ever
// writes, never accepted from a client request (see payment.schema.ts's CancelPaymentSchema).
export async function sweepOnce(pool: Pool, paymentRepository: PaymentRepository, chargeRepository: ChargeRepository, outboxRepository: OutboxRepository): Promise<number> {
  let sweptCount = 0;

  await withTransaction(pool, async (client: PoolClient) => {
    const due = await client.query<{ id: number; merchant_id: number }>(
      `SELECT id, merchant_id FROM payments
       WHERE status = 'requires_capture' AND capture_expires_at < now()
       ORDER BY capture_expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of due.rows) {
      const updated = await paymentRepository.applyCancel(row.id, ["requires_capture"], "expired", client);
      if (!updated) continue; // lost a race to something else in between the SELECT and here

      const charges = await chargeRepository.listByPaymentId(updated.id, client);
      await outboxRepository.append(row.merchant_id, "payment.canceled", toPaymentView(updated, charges), client);
      sweptCount++;
    }
  });

  return sweptCount;
}

export function startHoldExpirySweeper(
  pool: Pool,
  paymentRepository: PaymentRepository,
  chargeRepository: ChargeRepository,
  outboxRepository: OutboxRepository,
  intervalMs: number,
): NodeJS.Timeout {
  return setInterval(() => {
    sweepOnce(pool, paymentRepository, chargeRepository, outboxRepository).catch((err) =>
      console.error("hold-expiry sweeper error", err),
    );
  }, intervalMs);
}
