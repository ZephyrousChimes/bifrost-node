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

export interface PaymentRepository {
  insert(input: InsertPaymentInput, executor?: Queryable): Promise<PaymentRow>;
  findByPublicIdAndMerchantId(publicId: string, merchantId: number): Promise<PaymentRow | null>;
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

    async findByPublicIdAndMerchantId(publicId, merchantId) {
      const result = await pool.query<PaymentRow>(
        `SELECT * FROM payments WHERE public_id = $1 AND merchant_id = $2`,
        [publicId, merchantId],
      );
      return result.rows[0] ?? null;
    },
  };
}
