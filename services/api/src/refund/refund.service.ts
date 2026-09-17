import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { generatePublicId } from "../lib/publicId";
import { InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { PaymentRepository } from "../payment/payment.repository";
import { RefundRepository, RefundRow } from "./refund.repository";
import { CreateRefundInput } from "./refund.schema";
import { computeMerchantBalance, postLedgerTransaction, LedgerEntryInput } from "../ledger/ledger.repository";
import { OutboxRepository } from "../outbox/outbox.repository";
import { toRefundView } from "./refund.view";

export interface RefundWithPayment {
  refund: RefundRow;
  paymentPublicId: string;
}

export interface RefundService {
  create(merchantId: number, input: CreateRefundInput): Promise<RefundWithPayment>;
  get(merchantId: number, publicId: string): Promise<RefundWithPayment>;
}

export function createRefundService(
  pool: Pool,
  paymentRepository: PaymentRepository,
  refundRepository: RefundRepository,
  outboxRepository: OutboxRepository,
): RefundService {
  return {
    async create(merchantId, input) {
      return withTransaction(pool, async (client) => {
        const payment = await paymentRepository.lockByPublicIdAndMerchantId(input.payment, merchantId, client);
        if (!payment) {
          throw new ResourceNotFoundError(`No such payment: ${input.payment}`);
        }

        const remaining = payment.amount_captured - payment.amount_refunded;
        if (remaining <= 0) {
          throw new InvalidRequestError("This payment has nothing left to refund.", "payment");
        }
        const refundAmount = input.amount ?? remaining;
        if (refundAmount > remaining) {
          throw new InvalidRequestError(`amount exceeds the un-refunded remainder of ${remaining}.`, "amount");
        }

        const refund = await refundRepository.insert(
          {
            publicId: generatePublicId("re_"),
            paymentId: payment.id,
            merchantId,
            amount: refundAmount,
            currency: payment.currency,
            status: "succeeded",
            reason: input.reason,
          },
          client,
        );

        // The platform fee is retained by default (see openapi/bifrost.v1.yaml#createRefund), so
        // only the merchant's share reverses — take it from `pending` first, and only spill into
        // `available` (which can legitimately go negative, per spec) once pending is exhausted.
        const balances = await computeMerchantBalance(client, merchantId);
        const currentBalance = balances.find((b) => b.currency === payment.currency);
        const pendingAvailable = Math.max(currentBalance?.pending ?? 0, 0);

        const pendingPortion = Math.min(refundAmount, pendingAvailable);
        const availablePortion = refundAmount - pendingPortion;

        const entries: LedgerEntryInput[] = [
          {
            accountType: "acquirer_receivable",
            merchantId: null,
            direction: "credit",
            amount: refundAmount,
            currency: payment.currency,
            paymentId: payment.id,
            refundId: refund.id,
          },
        ];
        if (pendingPortion > 0) {
          entries.push({
            accountType: "merchant_payable_pending",
            merchantId,
            direction: "debit",
            amount: pendingPortion,
            currency: payment.currency,
            paymentId: payment.id,
            refundId: refund.id,
          });
        }
        if (availablePortion > 0) {
          entries.push({
            accountType: "merchant_payable_available",
            merchantId,
            direction: "debit",
            amount: availablePortion,
            currency: payment.currency,
            paymentId: payment.id,
            refundId: refund.id,
          });
        }
        await postLedgerTransaction(client, entries);

        await paymentRepository.applyRefund(payment.id, refundAmount, client);
        await outboxRepository.append(merchantId, "refund.succeeded", toRefundView(refund, payment.public_id), client);

        return { refund, paymentPublicId: payment.public_id };
      });
    },

    async get(merchantId, publicId) {
      const refund = await refundRepository.findByPublicIdAndMerchantId(publicId, merchantId);
      if (!refund) {
        throw new ResourceNotFoundError(`No such refund: ${publicId}`);
      }
      const payment = await paymentRepository.findById(refund.payment_id);
      return { refund, paymentPublicId: payment!.public_id };
    },
  };
}
