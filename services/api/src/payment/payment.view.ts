import { PaymentRow } from "./payment.repository";
import { ChargeRow } from "./charge.repository";
import { toChargeView } from "./charge.view";

// Wire shape for openapi/bifrost.v1.yaml#Payment.
export function toPaymentView(payment: PaymentRow, charges: ChargeRow[] = []) {
  const latestCharge = charges.find((c) => c.id === payment.latest_charge_id);
  return {
    id: payment.public_id,
    object: "payment",
    amount: payment.amount,
    amount_captured: payment.amount_captured,
    amount_refunded: payment.amount_refunded,
    currency: payment.currency,
    status: payment.status,
    capture_method: payment.capture_method,
    latest_charge: latestCharge ? latestCharge.public_id : null,
    charges: charges.map((c) => toChargeView(c, payment.public_id)),
    description: payment.description,
    metadata: payment.metadata,
    cancellation_reason: payment.cancellation_reason,
    created_at: payment.created_at,
    updated_at: payment.updated_at,
  };
}
