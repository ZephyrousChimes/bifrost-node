import { Queryable } from "../db/types";

export interface MerchantRow {
  id: number;
  public_id: string;
  name: string;
  email: string;
  created_at: Date;
}

export interface MerchantRepository {
  insert(publicId: string, name: string, email: string, executor?: Queryable): Promise<MerchantRow>;
}

export function createMerchantRepository(pool: Queryable): MerchantRepository {
  return {
    async insert(publicId, name, email, executor = pool) {
      const result = await executor.query<MerchantRow>(
        `INSERT INTO merchants (public_id, name, email) VALUES ($1, $2, $3) RETURNING *`,
        [publicId, name, email],
      );
      return result.rows[0];
    },
  };
}
