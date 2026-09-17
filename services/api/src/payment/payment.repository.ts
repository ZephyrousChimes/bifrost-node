import { Queryable } from "../db/types";

export interface PaymentRow {
  id: number;
  public_id: string;
  merchant_id: number;
  amount: number;
  currency: string;
  status: string;
  capture_method: string;
  amount_captured: number;
  amount_refunded: number;
  description: string | null;
  metadata: Record<string, string>;
  latest_charge_id: number | null;
  cancellation_reason: string | null;
  capture_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertPaymentInput {
  publicId: string;
  merchantId: number;
  amount: number;
  currency: string;
  captureMethod: string;
  description?: string;
  metadata: Record<string, string>;
}

// Every transition below is expressed as "the one legal predecessor status list -> the new
// status", enforced with `AND status = ANY($legalFrom)` in the same UPDATE rather than a
// read-then-check-then-write -- a concurrent second request racing the same transition can't
// both succeed, since only one UPDATE actually matches a row. Returns null (not a thrown error)
// when no row matched, so callers can distinguish "not found" from "found but illegal transition".
export interface PaymentRepository {
  insert(input: InsertPaymentInput, executor?: Queryable): Promise<PaymentRow>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number, executor?: Queryable): Promise<PaymentRow | null>;
  findById(id: number, executor?: Queryable): Promise<PaymentRow | null>;
  lockByPublicIdAndMerchantId(publicId: string, merchantId: number, executor: Queryable): Promise<PaymentRow | null>;

  transitionToProcessing(id: number, legalFrom: string[], executor: Queryable): Promise<PaymentRow | null>;
  applyChargeOutcome(
    id: number,
    legalFrom: string[],
    input: { status: string; latestChargeId: number; amountCaptured?: number; captureExpiresAt?: Date | null },
    executor: Queryable,
  ): Promise<PaymentRow | null>;
  applyCapture(id: number, legalFrom: string[], amountCaptured: number, executor: Queryable): Promise<PaymentRow | null>;
  applyCancel(id: number, legalFrom: string[], reason: string | null, executor: Queryable): Promise<PaymentRow | null>;
  applyRefund(id: number, amountRefunded: number, executor: Queryable): Promise<PaymentRow | null>;
}

export function createPaymentRepository(pool: Queryable): PaymentRepository {
  return {
    // Every payment starts at requires_confirmation — create() makes no external call and moves
    // no money, it only records intent. See openapi/bifrost.v1.yaml#createPayment.
    async insert(input, executor = pool) {
      const result = await executor.query<PaymentRow>(
        `INSERT INTO payments (public_id, merchant_id, amount, currency, status, capture_method, description, metadata)
         VALUES ($1, $2, $3, $4, 'requires_confirmation', $5, $6, $7)
         RETURNING *`,
        [
          input.publicId,
          input.merchantId,
          input.amount,
          input.currency,
          input.captureMethod,
          input.description ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      return result.rows[0];
    },

    async findByPublicIdAndMerchantId(publicId, merchantId, executor = pool) {
      const result = await executor.query<PaymentRow>(
        `SELECT * FROM payments WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async findById(id, executor = pool) {
      const result = await executor.query<PaymentRow>(`SELECT * FROM payments WHERE id = $1`, [id]);
      return result.rows[0] ?? null;
    },

    // FOR UPDATE: every mutating operation (confirm/capture/cancel) locks the row first, inside
    // the same database transaction as its ledger writes and status update. This is what makes
    // "legal transition" checks race-safe against two concurrent requests for the same payment,
    // not just against a repeated Idempotency-Key.
    async lockByPublicIdAndMerchantId(publicId, merchantId, executor) {
      const result = await executor.query<PaymentRow>(
        `SELECT * FROM payments WHERE public_id = $1 AND merchant_id = $2 FOR UPDATE`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },

    async transitionToProcessing(id, legalFrom, executor) {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments SET status = 'processing', updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
         RETURNING *`,
        [id, legalFrom],
      );
      return result.rows[0] ?? null;
    },

    async applyChargeOutcome(id, legalFrom, input, executor) {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments
         SET status = $3,
             latest_charge_id = $4,
             amount_captured = COALESCE($5, amount_captured),
             capture_expires_at = $6,
             updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
         RETURNING *`,
        [id, legalFrom, input.status, input.latestChargeId, input.amountCaptured ?? null, input.captureExpiresAt ?? null],
      );
      return result.rows[0] ?? null;
    },

    async applyCapture(id, legalFrom, amountCaptured, executor) {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments
         SET status = 'succeeded', amount_captured = $3, capture_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
         RETURNING *`,
        [id, legalFrom, amountCaptured],
      );
      return result.rows[0] ?? null;
    },

    async applyCancel(id, legalFrom, reason, executor) {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments
         SET status = 'canceled', cancellation_reason = $3, capture_expires_at = NULL, updated_at = now()
         WHERE id = $1 AND status = ANY($2::text[])
         RETURNING *`,
        [id, legalFrom, reason],
      );
      return result.rows[0] ?? null;
    },

    async applyRefund(id, amountRefunded, executor) {
      const result = await executor.query<PaymentRow>(
        `UPDATE payments SET amount_refunded = amount_refunded + $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [id, amountRefunded],
      );
      return result.rows[0] ?? null;
    },
  };
}
