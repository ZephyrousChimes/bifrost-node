import { Queryable } from "../db/types";

export interface IdempotencyRecord {
  id: number;
  merchant_id: number;
  key: string;
  request_fingerprint: string;
  response_status: number | null;
  response_body: unknown;
  started_at: Date;
  completed_at: Date | null;
}

export interface IdempotencyRepository {
  // Atomically claims the key for this merchant if it's unseen, in one round trip — the INSERT
  // either creates the row (this caller executes the request) or hits the unique constraint and
  // falls through to the SELECT (this caller replays/conflicts). Two concurrent first-time
  // requests for the same key race the INSERT; exactly one wins.
  claimOrGet(merchantId: number, key: string, requestFingerprint: string, executor: Queryable): Promise<{ record: IdempotencyRecord; claimed: boolean }>;
  complete(id: number, responseStatus: number, responseBody: unknown, executor: Queryable): Promise<void>;
}

export function createIdempotencyRepository(): IdempotencyRepository {
  return {
    async claimOrGet(merchantId, key, requestFingerprint, executor) {
      const inserted = await executor.query<IdempotencyRecord>(
        `INSERT INTO idempotency_keys (merchant_id, key, request_fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (merchant_id, key) DO NOTHING
         RETURNING *`,
        [merchantId, key, requestFingerprint],
      );
      if (inserted.rows[0]) {
        return { record: inserted.rows[0], claimed: true };
      }

      const existing = await executor.query<IdempotencyRecord>(
        `SELECT * FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
        [merchantId, key],
      );
      return { record: existing.rows[0], claimed: false };
    },

    async complete(id, responseStatus, responseBody, executor) {
      await executor.query(
        `UPDATE idempotency_keys SET response_status = $2, response_body = $3, completed_at = now() WHERE id = $1`,
        [id, responseStatus, JSON.stringify(responseBody)],
      );
    },
  };
}
