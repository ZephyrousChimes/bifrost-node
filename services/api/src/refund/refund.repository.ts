import { Queryable } from "../db/types";

export interface RefundRow {
  id: number;
  public_id: string;
  payment_id: number;
  merchant_id: number;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  reason: string | null;
  failure_reason: string | null;
  created_at: Date;
}

export interface InsertRefundInput {
  publicId: string;
  paymentId: number;
  merchantId: number;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  reason?: string;
  failureReason?: string;
}

export interface RefundRepository {
  insert(input: InsertRefundInput, executor: Queryable): Promise<RefundRow>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number, executor?: Queryable): Promise<RefundRow | null>;
}

export function createRefundRepository(pool: Queryable): RefundRepository {
  return {
    async insert(input, executor) {
      const result = await executor.query<RefundRow>(
        `INSERT INTO refunds (public_id, payment_id, merchant_id, amount, currency, status, reason, failure_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.publicId,
          input.paymentId,
          input.merchantId,
          input.amount,
          input.currency,
          input.status,
          input.reason ?? null,
          input.failureReason ?? null,
        ],
      );
      return result.rows[0];
    },

    async findByPublicIdAndMerchantId(publicId, merchantId, executor = pool) {
      const result = await executor.query<RefundRow>(
        `SELECT * FROM refunds WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },
  };
}
