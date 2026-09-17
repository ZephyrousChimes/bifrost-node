import { Queryable } from "../db/types";

export interface ChargeRow {
  id: number;
  public_id: string;
  payment_id: number;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  payment_method: string;
  acquirer_reference: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
}

export interface InsertChargeInput {
  publicId: string;
  paymentId: number;
  amount: number;
  currency: string;
  status: "succeeded" | "failed";
  paymentMethod: string;
  acquirerReference?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface ChargeRepository {
  insert(input: InsertChargeInput, executor: Queryable): Promise<ChargeRow>;
  listByPaymentId(paymentId: number, executor: Queryable): Promise<ChargeRow[]>;
}

export function createChargeRepository(): ChargeRepository {
  return {
    async insert(input, executor) {
      const result = await executor.query<ChargeRow>(
        `INSERT INTO charges (public_id, payment_id, amount, currency, status, payment_method, acquirer_reference, failure_code, failure_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.publicId,
          input.paymentId,
          input.amount,
          input.currency,
          input.status,
          input.paymentMethod,
          input.acquirerReference ?? null,
          input.failureCode ?? null,
          input.failureMessage ?? null,
        ],
      );
      return result.rows[0];
    },

    async listByPaymentId(paymentId, executor) {
      const result = await executor.query<ChargeRow>(
        `SELECT * FROM charges WHERE payment_id = $1 ORDER BY created_at ASC`,
        [paymentId],
      );
      return result.rows;
    },
  };
}
