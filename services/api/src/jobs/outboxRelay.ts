import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { OutboxRepository } from "../outbox/outbox.repository";
import { signWebhookPayload } from "../lib/signature";
import { toEventView } from "../event/event.view";

const BATCH_SIZE = 20;
const MAX_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes

function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
}

// Polls for due, undelivered events and POSTs each to its merchant's registered webhook_url,
// signed the way the OpenAPI spec's webhooks section documents. At-least-once, unordered: a
// receiver crashing mid-delivery just means the event is retried, possibly after the receiver
// already processed it once -- which is why the spec tells receivers to be idempotent on
// event.id, not this relay's job to guarantee exactly-once.
export async function relayOnce(pool: Pool, outboxRepository: OutboxRepository, fetchImpl: typeof fetch = fetch): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;

  await withTransaction(pool, async (client) => {
    const batch = await outboxRepository.claimDueBatch(BATCH_SIZE, client);

    for (const event of batch) {
      const merchantResult = await client.query<{ webhook_url: string | null; webhook_secret: string | null }>(
        `SELECT webhook_url, webhook_secret FROM merchants WHERE id = $1`,
        [event.merchant_id],
      );
      const merchant = merchantResult.rows[0];

      if (!merchant?.webhook_url) {
        // No endpoint registered: not a failure, just nothing to deliver to yet. Leave it
        // pending indefinitely rather than burning retry attempts against nowhere.
        continue;
      }

      const body = JSON.stringify(toEventView(event));
      const { header } = signWebhookPayload(merchant.webhook_secret ?? "", body);

      try {
        const response = await fetchImpl(merchant.webhook_url, {
          method: "POST",
          headers: { "content-type": "application/json", "bifrost-signature": header },
          body,
        });
        if (response.ok) {
          await outboxRepository.markDelivered(event.id, client);
          delivered++;
        } else {
          await outboxRepository.markAttemptFailed(event.id, new Date(Date.now() + backoffMs(event.attempts)), client);
          failed++;
        }
      } catch {
        await outboxRepository.markAttemptFailed(event.id, new Date(Date.now() + backoffMs(event.attempts)), client);
        failed++;
      }
    }
  });

  return { delivered, failed };
}

export function startOutboxRelay(pool: Pool, outboxRepository: OutboxRepository, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    relayOnce(pool, outboxRepository).catch((err) => console.error("outbox relay error", err));
  }, intervalMs);
}
