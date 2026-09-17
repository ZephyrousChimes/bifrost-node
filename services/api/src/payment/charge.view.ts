import { ChargeRow } from "./charge.repository";

export function toChargeView(charge: ChargeRow, paymentPublicId: string) {
  return {
    id: charge.public_id,
    object: "charge",
    payment: paymentPublicId,
    amount: charge.amount,
    currency: charge.currency,
    status: charge.status,
    acquirer_reference: charge.acquirer_reference,
    failure_code: charge.failure_code,
    failure_message: charge.failure_message,
    created_at: charge.created_at,
  };
}
