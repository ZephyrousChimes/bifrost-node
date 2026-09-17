import { createApp } from "./app";
import { pool } from "./db/pool";
import { env } from "./config/env";
import { createPaymentRepository } from "./payment/payment.repository";
import { createChargeRepository } from "./payment/charge.repository";
import { createOutboxRepository } from "./outbox/outbox.repository";
import { startOutboxRelay } from "./jobs/outboxRelay";
import { startHoldExpirySweeper } from "./jobs/holdExpirySweeper";
import { startPayoutMaturitySweeper } from "./jobs/payoutMaturitySweeper";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`bifrost-api listening on :${env.PORT}`);
});

// Background jobs share the same pool as the request path -- each poll runs its own short
// transaction (withTransaction), so a slow sweep can't hold a connection open indefinitely and
// starve the request path of pool connections.
const paymentRepository = createPaymentRepository(pool);
const chargeRepository = createChargeRepository();
const outboxRepository = createOutboxRepository();

const relayHandle = startOutboxRelay(pool, outboxRepository, env.OUTBOX_RELAY_POLL_MS);
const holdExpiryHandle = startHoldExpirySweeper(pool, paymentRepository, chargeRepository, outboxRepository, env.SWEEPER_POLL_MS);
const payoutMaturityHandle = startPayoutMaturitySweeper(pool, outboxRepository, env.SWEEPER_POLL_MS);

// ECS/Fargate (and any orchestrator) sends SIGTERM before killing a container. Node won't stop
// accepting connections or close the pool on its own — skipping this risks exactly the kind of
// mid-flight-request data loss the idempotency design exists to prevent.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  clearInterval(relayHandle);
  clearInterval(holdExpiryHandle);
  clearInterval(payoutMaturityHandle);
  server.close(async (err) => {
    if (err) {
      console.error(err);
      process.exitCode = 1;
    }
    await pool.end();
    process.exit();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
