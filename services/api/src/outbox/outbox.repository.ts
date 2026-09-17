import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";

export type EventType =
  | "payment.created"
  | "payment.requires_capture"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "refund.succeeded"
  | "refund.failed"
  | "payout.paid";

export interface OutboxEventRow {
  id: number;
  public_id: string;
  merchant_id: number;
  type: EventType;
  payload: unknown;
  created_at: Date;
  delivered_at: Date | null;
  attempts: number;
  next_attempt_at: Date;
}

export interface OutboxRepository {
  // Writes the event row in the same database transaction as the state change it describes —
  // called with the same `executor` (a PoolClient inside withTransaction) as the payment/refund
  // write, never against the bare pool. That's what makes GET /v1/events unable to disagree
  // with the objects it reports on: the event physically cannot exist unless the change committed.
  append(merchantId: number, type: EventType, payload: unknown, executor: Queryable): Promise<OutboxEventRow>;
  listByMerchant(merchantId: number, limit: number, executor: Queryable): Promise<OutboxEventRow[]>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number, executor: Queryable): Promise<OutboxEventRow | null>;

  // Relay-side: claim a batch of due, undelivered events and record each delivery attempt.
  claimDueBatch(limit: number, executor: Queryable): Promise<OutboxEventRow[]>;
  markDelivered(id: number, executor: Queryable): Promise<void>;
  markAttemptFailed(id: number, nextAttemptAt: Date, executor: Queryable): Promise<void>;
}

export function createOutboxRepository(): OutboxRepository {
  return {
    async append(merchantId, type, payload, executor) {
      const result = await executor.query<OutboxEventRow>(
        `INSERT INTO outbox_events (public_id, merchant_id, type, payload) VALUES ($1, $2, $3, $4) RETURNING *`,
        [generatePublicId("evt_"), merchantId, type, JSON.stringify(payload)],
      );
      return result.rows[0];
    },

    async listByMerchant(merchantId, limit, executor) {
      const result = await executor.query<OutboxEventRow>(
        `SELECT * FROM outbox_events WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [merchantId, limit],
      );
      return result.rows;
    },

    async findByPublicIdAndMerchantId(publicId, merchantId, executor) {
      const result = await executor.query<OutboxEventRow>(
        `SELECT * FROM outbox_events WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async claimDueBatch(limit, executor) {
      // SKIP LOCKED: safe to run more than one relay worker concurrently -- each claims a
      // disjoint batch instead of blocking on rows another worker already picked up.
      const result = await executor.query<OutboxEventRow>(
        `SELECT * FROM outbox_events
         WHERE delivered_at IS NULL AND next_attempt_at <= now()
         ORDER BY next_attempt_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      return result.rows;
    },

    async markDelivered(id, executor) {
      await executor.query(`UPDATE outbox_events SET delivered_at = now() WHERE id = $1`, [id]);
    },

    async markAttemptFailed(id, nextAttemptAt, executor) {
      await executor.query(
        `UPDATE outbox_events SET attempts = attempts + 1, next_attempt_at = $2 WHERE id = $1`,
        [id, nextAttemptAt],
      );
    },
  };
}
