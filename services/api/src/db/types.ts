import { Pool, PoolClient } from "pg";

// A repository method that needs to be able to join a caller's transaction, not just run
// against the pool, accepts this instead of `Pool` directly — `PoolClient` shares the same
// `.query` shape, so the same SQL runs whether it's inside a transaction or not.
export type Queryable = Pool | PoolClient;
