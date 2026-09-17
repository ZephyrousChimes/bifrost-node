import { RefundRow } from "./refund.repository";

export function toRefundView(refund: RefundRow, paymentPublicId: string) {
  return {
    id: refund.public_id,
    object: "refund",
    payment: paymentPublicId,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
    reason: refund.reason,
    failure_reason: refund.failure_reason,
    created_at: refund.created_at,
  };
}
