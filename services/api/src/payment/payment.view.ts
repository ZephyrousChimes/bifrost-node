import { PaymentRow } from "./payment.repository";

// Wire shape for openapi/bifrost.v1.yaml#Payment. latest_charge/charges/cancellation_reason are
// spec fields with no backing data yet (no charges table until `confirm` exists) — present and
// empty/null rather than omitted, so the response shape is already stable for later work.
export function toPaymentView(payment: PaymentRow) {
  return {
    id: payment.public_id,
    object: "payment",
    amount: payment.amount,
    amount_captured: payment.amount_captured,
    amount_refunded: payment.amount_refunded,
    currency: payment.currency,
    status: payment.status,
    capture_method: payment.capture_method,
    latest_charge: null,
    charges: [] as unknown[],
    description: payment.description,
    metadata: payment.metadata,
    cancellation_reason: null,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}
