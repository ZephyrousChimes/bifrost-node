import { Pool, types } from "pg";
import { env } from "../config/env";

// BIGINT (OID 20) comes back as a string by default, since it can exceed Number.MAX_SAFE_INTEGER.
// This project's amounts (minor units of a payment) never approach that, and the OpenAPI spec
// serializes amounts as plain JSON numbers — so parse eagerly here rather than converting at
// every call site.
types.setTypeParser(20, (value) => parseInt(value, 10));

// NUMERIC (OID 1700) — what SUM() over a bigint column actually returns, not BIGINT, so the
// parser above alone doesn't cover it. Ledger balance queries (SUM of amounts, grouped by
// account) hit this every time; without this, `/v1/balance` would silently serialize amounts as
// JSON strings ("48550") instead of the integers the OpenAPI Amount schema promises.
types.setTypeParser(1700, (value) => parseInt(value, 10));

export const pool = new Pool({ connectionString: env.DATABASE_URL });
