import { Pool, types } from "pg";
import { env } from "../config/env";

// BIGINT (OID 20) comes back as a string by default, since it can exceed Number.MAX_SAFE_INTEGER.
// This project's amounts (minor units of a payment) never approach that, and the OpenAPI spec
// serializes amounts as plain JSON numbers — so parse eagerly here rather than converting at
// every call site.
types.setTypeParser(20, (value) => parseInt(value, 10));

export const pool = new Pool({ connectionString: env.DATABASE_URL });
