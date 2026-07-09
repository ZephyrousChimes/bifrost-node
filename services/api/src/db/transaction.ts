import { Pool, PoolClient } from "pg";

// Node's equivalent of Spring's @Transactional: no annotation does this implicitly, so the
// transaction boundary has to be an explicit block. Used wherever more than one write must
// commit or roll back together (merchant registration + its first API key).
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
