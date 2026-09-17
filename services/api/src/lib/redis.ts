import Redis from "ioredis";
import { env } from "../config/env";

export const redis = new Redis(env.REDIS_URL, {
  // Fail fast rather than buffering commands indefinitely if Redis is briefly unreachable —
  // the idempotency lock is a fast-path optimization, not the source of truth, so a caller
  // should see an error quickly and fall back rather than hang.
  maxRetriesPerRequest: 2,
  lazyConnect: false,
});

redis.on("error", (err) => {
  console.error("redis error", err.message);
});
