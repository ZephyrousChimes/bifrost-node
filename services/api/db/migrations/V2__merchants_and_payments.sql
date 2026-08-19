-- Merchants, their API keys, and the payment intent.
-- No ledger tables yet — creating a payment moves no money and writes no ledger rows.
-- Ported from bifrost-java's V2 migration (see reference/), one deliberate change: status and
-- capture_method are lowercase here. In Java they were uppercase because Hibernate's
-- EnumType.STRING writes the enum constant name verbatim — a serialization artifact, not part
-- of the schema's meaning. Node has no such constraint, and lowercase matches both Postgres
-- convention and the OpenAPI spec's own wire values, so the API layer needs no case mapping.

CREATE TABLE currencies (
    code        CHAR(3) PRIMARY KEY,          -- ISO 4217
    minor_unit  SMALLINT NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
    enabled     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('INR', 2, true);

INSERT INTO currencies (code, minor_unit, enabled) VALUES
    ('USD', 2, false),
    ('JPY', 0, false);

CREATE TABLE merchants (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,               -- mer_...
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
    id          BIGSERIAL PRIMARY KEY,
    public_id   TEXT NOT NULL UNIQUE,                       -- key_...
    merchant_id BIGINT NOT NULL REFERENCES merchants(id),
    key_hash    TEXT NOT NULL UNIQUE,                        -- SHA-256(secret key), never the key itself
    prefix      TEXT NOT NULL,                                -- e.g. sk_test_a1b2c3d4, safe to display
    livemode    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ NULL
);

CREATE INDEX ON api_keys (merchant_id);

CREATE TABLE payments (
    id               BIGSERIAL PRIMARY KEY,
    public_id        TEXT NOT NULL UNIQUE,           -- pay_...
    merchant_id      BIGINT NOT NULL REFERENCES merchants(id),

    amount           BIGINT NOT NULL CHECK (amount > 0),
    currency         CHAR(3) NOT NULL REFERENCES currencies(code),

    -- Terminal states are succeeded and canceled. There is no payment-level "failed": a
    -- declined charge returns the payment to requires_confirmation so another card can be
    -- tried — only a charge fails, never the payment itself.
    status           TEXT NOT NULL CHECK (status IN (
                         'requires_confirmation',
                         'processing',
                         'requires_capture',
                         'succeeded',
                         'canceled'
                     )),
    capture_method   TEXT NOT NULL CHECK (capture_method IN ('automatic', 'manual')),

    amount_captured  BIGINT NOT NULL DEFAULT 0 CHECK (amount_captured >= 0),
    amount_refunded  BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),

    description      TEXT,
    metadata         JSONB NOT NULL DEFAULT '{}',

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON payments (merchant_id, created_at DESC);
