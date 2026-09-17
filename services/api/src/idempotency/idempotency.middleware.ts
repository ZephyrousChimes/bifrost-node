import { Request, RequestHandler, Response } from "express";
import { redis } from "../lib/redis";
import { sha256Hex } from "../lib/hash";
import { errorEnvelope } from "../lib/errorEnvelope";
import { pool } from "../db/pool";
import { IdempotencyRepository } from "./idempotency.repository";

const LOCK_TTL_MS = 30_000; // generous over any single request's expected latency

export interface RouteResult {
  status: number;
  body: unknown;
}

export type IdempotentHandler = (req: Request) => Promise<RouteResult>;

function fingerprint(req: Request): string {
  return sha256Hex(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? {})}`);
}

// Wraps a route handler with the full idempotency contract: Redis is checked first as a
// fast-path in-flight lock (cheap, in-memory, rejects the common case of an impatient retry
// arriving while the first attempt is still running without a database round trip at all);
// Postgres is only consulted when Redis has no lock for this key, and remains the durable
// source of truth for replaying a *completed* response, including after the Redis lock has
// expired or the process restarted.
export function idempotent(idempotencyRepository: IdempotencyRepository, handler: IdempotentHandler): RequestHandler {
  return async (req: Request, res: Response) => {
    const key = req.header("idempotency-key");
    if (!key) {
      res
        .status(400)
        .json(errorEnvelope("invalid_request_error", "parameter_missing", "Missing required header: Idempotency-Key.", "Idempotency-Key"));
      return;
    }

    const merchantId = req.merchantId!;
    const requestFingerprint = fingerprint(req);
    const lockKey = `idem:${merchantId}:${key}`;

    const lockAcquired = (await redis.set(lockKey, requestFingerprint, "PX", LOCK_TTL_MS, "NX")) === "OK";
    if (!lockAcquired) {
      res
        .status(409)
        .json(errorEnvelope("idempotency_error", "idempotency_key_in_use", "A request with this Idempotency-Key is currently in progress."));
      return;
    }

    try {
      const { record, claimed } = await idempotencyRepository.claimOrGet(merchantId, key, requestFingerprint, pool);

      if (!claimed) {
        if (record.request_fingerprint !== requestFingerprint) {
          res
            .status(422)
            .json(
              errorEnvelope(
                "idempotency_error",
                "idempotency_key_reused",
                "This Idempotency-Key was previously used with different request parameters.",
              ),
            );
          return;
        }
        if (!record.completed_at) {
          res
            .status(409)
            .json(errorEnvelope("idempotency_error", "idempotency_key_in_use", "A request with this Idempotency-Key is currently in progress."));
          return;
        }
        res.status(record.response_status!).set("Idempotent-Replay", "true").json(record.response_body);
        return;
      }

      const result = await handler(req);
      await idempotencyRepository.complete(record.id, result.status, result.body, pool);
      res.status(result.status).json(result.body);
    } finally {
      // Release only if we still hold it (best-effort — a crash between acquiring the lock and
      // this line just means the key sits locked until LOCK_TTL_MS expires, after which Postgres
      // is consulted directly and correctly reports the request as never completed).
      const current = await redis.get(lockKey);
      if (current === requestFingerprint) {
        await redis.del(lockKey);
      }
    }
  };
}
