-- The core payments engine: charges, refunds, the double-entry ledger, idempotency keys, and
-- the transactional outbox. Everything a payment actually *does* to money lives here; V2 only
-- recorded intent.

-- ---------------------------------------------------------------------------------- charges

CREATE TABLE charges (
    id               BIGSERIAL PRIMARY KEY,
    public_id        TEXT NOT NULL UNIQUE,                    -- ch_...
    payment_id       BIGINT NOT NULL REFERENCES payments(id),
    amount           BIGINT NOT NULL CHECK (amount > 0),
    currency         CHAR(3) NOT NULL REFERENCES currencies(code),
    status           TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    payment_method    TEXT NOT NULL,                          -- the test token, e.g. pm_card_visa
    acquirer_reference TEXT,
    failure_code     TEXT,
    failure_message  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON charges (payment_id, created_at DESC);

-- The payment always knows its most recent attempt without a correlated subquery on `charges`.
ALTER TABLE payments ADD COLUMN latest_charge_id BIGINT REFERENCES charges(id);
ALTER TABLE payments ADD COLUMN cancellation_reason TEXT
    CHECK (cancellation_reason IN ('duplicate', 'fraudulent', 'requested_by_customer', 'abandoned', 'expired'));

-- An authorized-but-uncaptured payment expires on its own after this many seconds; the
-- hold-expiry sweeper (src/jobs/holdExpirySweeper.ts) cancels anything past this deadline. Set
-- only on entering requires_capture, cleared on every other transition.
ALTER TABLE payments ADD COLUMN capture_expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------------- refunds

CREATE TABLE refunds (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,                          -- re_...
    payment_id  BIGINT NOT NULL REFERENCES payments(id),
    merchant_id BIGINT NOT NULL REFERENCES merchants(id),
    amount      BIGINT NOT NULL CHECK (amount > 0),
    currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    status      TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
    reason      TEXT CHECK (reason IN ('duplicate', 'fraudulent', 'requested_by_customer')),
    failure_reason TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON refunds (payment_id, created_at DESC);
CREATE INDEX ON refunds (merchant_id, created_at DESC);

-- ---------------------------------------------------------------------------------- ledger
--
-- Every ledger transaction is a set of entries sharing one ledger_transaction_id, and the
-- deferred trigger below is the actual enforcement of sum(debits) = sum(credits) per
-- transaction per currency -- a CHECK constraint can't aggregate across rows, so this is the
-- standard Postgres idiom for a cross-row invariant: a constraint trigger, deferrable, that
-- only fires at COMMIT rather than after every individual row insert.

CREATE TABLE ledger_accounts (
    id          BIGSERIAL PRIMARY KEY,
    -- NULL merchant_id is a platform account (acquirer_receivable, platform_fee_revenue);
    -- non-null is a merchant's own pending/available balance.
    merchant_id BIGINT REFERENCES merchants(id),
    type        TEXT NOT NULL CHECK (type IN (
                    'acquirer_receivable',
                    'platform_fee_revenue',
                    'merchant_payable_pending',
                    'merchant_payable_available'
                )),
    currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One platform account per (type, currency); one merchant account per (merchant, type, currency).
CREATE UNIQUE INDEX ledger_accounts_platform_uq
    ON ledger_accounts (type, currency) WHERE merchant_id IS NULL;
CREATE UNIQUE INDEX ledger_accounts_merchant_uq
    ON ledger_accounts (merchant_id, type, currency) WHERE merchant_id IS NOT NULL;

CREATE TABLE ledger_entries (
    id                    BIGSERIAL PRIMARY KEY,
    ledger_transaction_id UUID NOT NULL,          -- groups the balanced set of entries
    account_id            BIGINT NOT NULL REFERENCES ledger_accounts(id),
    direction             TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount                BIGINT NOT NULL CHECK (amount > 0),
    currency              CHAR(3) NOT NULL REFERENCES currencies(code),

    -- Traceability back to what caused this entry. Exactly one of these is set per entry in
    -- practice, but that's a convention enforced in ledger.repository.ts, not the schema --
    -- a maturity-sweep entry, for instance, is caused by neither a payment nor a charge.
    payment_id BIGINT REFERENCES payments(id),
    charge_id  BIGINT REFERENCES charges(id),
    refund_id  BIGINT REFERENCES refunds(id),

    -- Set only on merchant_payable_pending credit entries: when the payout maturity sweeper
    -- (src/jobs/payoutMaturitySweeper.ts) should move this money to the available account.
    matures_at TIMESTAMPTZ,
    swept_at   TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger_entries (ledger_transaction_id);
CREATE INDEX ON ledger_entries (account_id);
CREATE INDEX ledger_entries_maturity_idx ON ledger_entries (matures_at)
    WHERE matures_at IS NOT NULL AND swept_at IS NULL;

-- The invariant itself: for every ledger_transaction_id touched by this statement, debits must
-- equal credits *per currency*. AFTER ... FOR EACH ROW, DEFERRABLE INITIALLY DEFERRED means this
-- runs once per affected row but its check only actually executes at COMMIT (or an explicit
-- SET CONSTRAINTS ... IMMEDIATE) -- so inserting a transaction's entries one at a time within a
-- single database transaction is legal; only an unbalanced transaction that survives to commit
-- is rejected.
CREATE OR REPLACE FUNCTION check_ledger_transaction_balanced() RETURNS TRIGGER AS $$
DECLARE
    unbalanced RECORD;
BEGIN
    SELECT currency,
           SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) AS debits,
           SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS credits
    INTO unbalanced
    FROM ledger_entries
    WHERE ledger_transaction_id = NEW.ledger_transaction_id
    GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END)
         != SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'ledger_transaction % is unbalanced in %: debits=% credits=%',
            NEW.ledger_transaction_id, unbalanced.currency, unbalanced.debits, unbalanced.credits
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NULL; -- AFTER trigger return value is ignored
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_transaction_balanced
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_ledger_transaction_balanced();

-- Seed the platform-side accounts. Merchant accounts are created lazily, on that merchant's
-- first ledger transaction (see ledger.repository.ts) -- there's no signup-time event that
-- needs them yet.
INSERT INTO ledger_accounts (merchant_id, type, currency)
VALUES (NULL, 'acquirer_receivable', 'INR'),
       (NULL, 'platform_fee_revenue', 'INR');

-- ---------------------------------------------------------------------------------- idempotency

CREATE TABLE idempotency_keys (
    id                   BIGSERIAL PRIMARY KEY,
    merchant_id          BIGINT NOT NULL REFERENCES merchants(id),
    key                  TEXT NOT NULL,
    -- sha256("<method> <path>\n<body>") -- lets a replay of the same key be distinguished from
    -- reuse with a different request, without storing the (possibly sensitive) request body twice.
    request_fingerprint  TEXT NOT NULL,
    response_status      INT,
    response_body        JSONB,
    -- NULL while the original request is still executing; a concurrent request for the same key
    -- sees a non-NULL started_at with a NULL completed_at and returns 409 idempotency_key_in_use
    -- rather than racing the first request to completion.
    started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idempotency_keys_merchant_key_uq ON idempotency_keys (merchant_id, key);

-- ---------------------------------------------------------------------------------- outbox

CREATE TABLE outbox_events (
    id            BIGSERIAL PRIMARY KEY,
    public_id     TEXT NOT NULL UNIQUE,                        -- evt_...
    merchant_id   BIGINT NOT NULL REFERENCES merchants(id),
    type          TEXT NOT NULL CHECK (type IN (
                      'payment.created', 'payment.requires_capture', 'payment.succeeded',
                      'payment.failed', 'payment.canceled', 'refund.succeeded', 'refund.failed',
                      'payout.paid'
                  )),
    payload       JSONB NOT NULL,       -- the Event.data.object at the moment this fired
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Relay bookkeeping (src/jobs/outboxRelay.ts). delivered_at is set on the first 2xx; the
    -- event is never re-delivered after that. attempts/next_attempt_at drive exponential backoff.
    delivered_at    TIMESTAMPTZ,
    attempts        INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON outbox_events (merchant_id, created_at DESC);
CREATE INDEX outbox_events_pending_idx ON outbox_events (next_attempt_at)
    WHERE delivered_at IS NULL;

-- Where the relay POSTs events for this merchant. Nullable: a merchant with no endpoint
-- configured just accumulates undelivered events, which is a legitimate steady state, not
-- an error -- GET /v1/events still serves them.
ALTER TABLE merchants ADD COLUMN webhook_url TEXT;
ALTER TABLE merchants ADD COLUMN webhook_secret TEXT;
