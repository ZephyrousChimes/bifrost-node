# Bifrost (Node)

A Stripe-style payment service provider sandbox: merchants register, create payments, confirm
them against a simulated acquirer, capture and refund, and receive webhooks. The full contract
lives in [`openapi/bifrost.v1.yaml`](openapi/bifrost.v1.yaml) — it's the source of truth this
implementation is built against, not the other way around.

## What's actually implemented

- **Double-entry ledger** (`src/ledger/`): every capture, refund, and payout-maturity sweep is a
  set of ledger entries sharing one transaction id, and a Postgres **deferred constraint
  trigger** (`V3__ledger_idempotency_outbox.sql`) rejects any transaction where
  `sum(debits) != sum(credits)` *per currency* at commit — not in application code. Verified
  directly: an unbalanced insert is accepted mid-transaction and rejected at `COMMIT` (see the
  ledger-invariant test in `src/__tests__/`).
- **Idempotency keys** (`src/idempotency/`): a Redis fast-path lock rejects a concurrent retry
  in-memory before it ever reaches Postgres; Postgres remains the durable source of truth for
  replaying a *completed* response (verbatim, with `Idempotent-Replay: true`) even after the
  Redis lock has expired or the process restarted. Reusing a key with a different request body
  is a `422`, not a cache hit.
- **Transactional outbox** (`src/outbox/`, `src/jobs/outboxRelay.ts`): every state-changing
  event is written in the *same* database transaction as the change it describes, then relayed
  at-least-once with exponential backoff and an HMAC-signed `Bifrost-Signature` header.
- **Authorize/capture state machine** (`src/payment/payment.service.ts`): every transition is a
  single `UPDATE ... WHERE status = ANY(legal_from)`, not a read-check-write, so two concurrent
  requests against the same payment can't both succeed at an illegal transition — only one
  `UPDATE` actually matches.
- **Two sweepers** (`src/jobs/`): a hold-expiry sweeper cancels an authorized-but-never-captured
  payment after its hold expires; a payout-maturity sweeper moves captured funds from `pending`
  to `available` as their own auditable ledger transaction, not an invisible balance `UPDATE`.
- **Merchant dashboard** (`frontend/`): a Next.js/TypeScript client over the same API a merchant
  would call directly — balance, recent payments, and the live event feed, polling every 5s.
  Its visual language (the violet aurora backdrop, the pill-button style, the AeonikPro font) is
  carried over from an earlier, unfinished landing-page prototype (`ajna-frontend`) — same
  aesthetic, now driving a real client with real data instead of a static hero section.

## A real bug this surfaced, and how it was found

The first version of the payout-maturity sweeper moved each matured ledger entry's *original*
captured amount from `pending` to `available`, independent of anything else that had touched
`pending` since. That's wrong the moment a refund lands on the same money before it matures: the
refund already debited `pending` for its share, so re-crediting the full original amount
double-counts it and drives the balance negative. Caught by manually running capture → refund →
wait-for-maturity and checking the resulting balance, not by assumption. The fix sweeps
`min(sum of due entries, current pending balance)` per merchant/currency instead of trusting
each entry's original amount in isolation — see the comment in
`src/jobs/payoutMaturitySweeper.ts` for the full reasoning.

Separately, `SUM()` over a `bigint` column in Postgres returns `numeric`, not `bigint` — a type
the existing `bigint` parser (`src/db/pool.ts`) didn't cover, so every ledger balance query was
silently serializing amounts as JSON strings (`"48550"`) instead of the integers the OpenAPI
`Amount` schema requires. Caught by an integration test asserting on the numeric type, not just
the value.

## Run it

```
docker compose up -d                     # Postgres + Redis
cp services/api/.env.example services/api/.env
npm install
npm run migrate:api
npm run dev:api                          # or: npx tsx src/server.ts from services/api
```

```
npm test --workspace services/api        # integration tests against the real DB + Redis
```

```
cd frontend
cp .env.example .env.local
npm install
npm run dev                              # http://localhost:3000, points at the API above
```

## Still open (not yet built)

- The acquirer simulator as its own deployable microservice (currently in-process, `src/payment/acquirer.ts`)
- CI, AWS deployment config, Prometheus metrics
- Cursor pagination on list endpoints
