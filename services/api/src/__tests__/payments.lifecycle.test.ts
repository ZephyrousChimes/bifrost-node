import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { createApp } from "../app";
import { pool } from "../db/pool";
import { redis } from "../lib/redis";

// Integration tests against a real Postgres + Redis (the same ones docker-compose.yml brings
// up) rather than mocks -- the whole point of this suite is proving the ledger invariant, the
// idempotency contract, and the state machine actually hold when driven through the real HTTP
// layer, not that the mocks were told the right things to return.

let server: Server;
let baseUrl: string;

before(async () => {
  await pool.query(
    `TRUNCATE ledger_entries, refunds, charges, payments, idempotency_keys, outbox_events, api_keys, merchants RESTART IDENTITY CASCADE`,
  );
  await pool.query(
    `INSERT INTO ledger_accounts (merchant_id, type, currency) VALUES (NULL, 'acquirer_receivable', 'INR'), (NULL, 'platform_fee_revenue', 'INR') ON CONFLICT DO NOTHING`,
  );

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  redis.disconnect();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses span every
// resource's wire shape (Payment, Refund, Balance, ErrorEnvelope); typing each call site
// individually would add ceremony without catching anything the assertions themselves don't.
async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

async function registerMerchant(email: string) {
  const { body } = await post("/v1/merchants", { name: "Test Co", email });
  return { authHeader: { authorization: `Bearer ${body.api_key.secret_key}` }, merchantId: body.merchant.id };
}

test("full lifecycle: create -> confirm -> capture -> partial refund -> balance", async () => {
  const { authHeader } = await registerMerchant("lifecycle@example.com");

  const created = await post(
    "/v1/payments",
    { amount: 50000, currency: "INR", capture_method: "manual" },
    { ...authHeader, "idempotency-key": "lc-create" },
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "requires_confirmation");

  const confirmed = await post(
    `/v1/payments/${created.body.id}/confirm`,
    { payment_method: "pm_card_visa" },
    { ...authHeader, "idempotency-key": "lc-confirm" },
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, "requires_capture");
  assert.equal(confirmed.body.charges[0].status, "succeeded");

  const captured = await post(`/v1/payments/${created.body.id}/capture`, {}, { ...authHeader, "idempotency-key": "lc-capture" });
  assert.equal(captured.status, 200);
  assert.equal(captured.body.status, "succeeded");
  assert.equal(captured.body.amount_captured, 50000);

  // 2.9% fee retained -> merchant sees 48550 pending
  const balanceAfterCapture = await get("/v1/balance", authHeader);
  assert.equal(balanceAfterCapture.body.pending[0].amount, 48550);
  assert.equal(balanceAfterCapture.body.available[0].amount, 0);

  const refunded = await post(
    "/v1/refunds",
    { payment: created.body.id, amount: 20000 },
    { ...authHeader, "idempotency-key": "lc-refund" },
  );
  assert.equal(refunded.status, 201);
  assert.equal(refunded.body.amount, 20000);

  const balanceAfterRefund = await get("/v1/balance", authHeader);
  assert.equal(balanceAfterRefund.body.pending[0].amount, 28550);
});

test("declined card: charge fails, payment returns to requires_confirmation, no ledger entries", async () => {
  const { authHeader } = await registerMerchant("declined@example.com");

  const created = await post("/v1/payments", { amount: 10000, currency: "INR" }, { ...authHeader, "idempotency-key": "dc-create" });
  const confirmed = await post(
    `/v1/payments/${created.body.id}/confirm`,
    { payment_method: "pm_card_declined" },
    { ...authHeader, "idempotency-key": "dc-confirm" },
  );

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, "requires_confirmation");
  assert.equal(confirmed.body.charges[0].status, "failed");
  assert.equal(confirmed.body.charges[0].failure_code, "card_declined");

  const balance = await get("/v1/balance", authHeader);
  assert.equal(balance.body.pending.length === 0 || balance.body.pending[0].amount === 0, true);
});

test("idempotency: replay returns the original response verbatim with Idempotent-Replay header", async () => {
  const { authHeader } = await registerMerchant("replay@example.com");

  const first = await post("/v1/payments", { amount: 777, currency: "INR" }, { ...authHeader, "idempotency-key": "replay-key" });
  const second = await post("/v1/payments", { amount: 777, currency: "INR" }, { ...authHeader, "idempotency-key": "replay-key" });

  assert.equal(second.status, 201);
  assert.equal(second.headers.get("idempotent-replay"), "true");
  assert.deepEqual(second.body, first.body);
});

test("idempotency: same key with a different body is rejected, not replayed", async () => {
  const { authHeader } = await registerMerchant("conflict@example.com");

  await post("/v1/payments", { amount: 100, currency: "INR" }, { ...authHeader, "idempotency-key": "conflict-key" });
  const conflicting = await post("/v1/payments", { amount: 200, currency: "INR" }, { ...authHeader, "idempotency-key": "conflict-key" });

  assert.equal(conflicting.status, 422);
  assert.equal(conflicting.body.error.code, "idempotency_key_reused");
});

test("illegal transition: capturing a payment that was never confirmed is rejected", async () => {
  const { authHeader } = await registerMerchant("illegal@example.com");

  const created = await post(
    "/v1/payments",
    { amount: 500, currency: "INR", capture_method: "manual" },
    { ...authHeader, "idempotency-key": "illegal-create" },
  );
  const captureAttempt = await post(`/v1/payments/${created.body.id}/capture`, {}, { ...authHeader, "idempotency-key": "illegal-capture" });

  assert.equal(captureAttempt.status, 409);
  assert.equal(captureAttempt.body.error.code, "payment_unexpected_state");
});

test("ledger invariant: an unbalanced transaction is rejected at commit, not silently accepted", async () => {
  const { randomUUID } = await import("node:crypto");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const acc = await client.query(`SELECT id FROM ledger_accounts WHERE type = 'acquirer_receivable' AND currency = 'INR'`);
    const accountId = acc.rows[0].id;
    const txId = randomUUID();
    await client.query(
      `INSERT INTO ledger_entries (ledger_transaction_id, account_id, direction, amount, currency) VALUES ($1, $2, 'debit', 100, 'INR')`,
      [txId, accountId],
    );
    // no offsetting credit -- this transaction is unbalanced and must fail at COMMIT
    await assert.rejects(() => client.query("COMMIT"), /unbalanced/);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});
