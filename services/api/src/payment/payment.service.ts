import { Pool } from "pg";
import { withTransaction } from "../db/transaction";
import { Queryable } from "../db/types";
import { generatePublicId } from "../lib/publicId";
import { IllegalTransitionError, InvalidRequestError, ResourceNotFoundError } from "../lib/errors";
import { env } from "../config/env";
import { PaymentRepository, PaymentRow } from "./payment.repository";
import { ChargeRepository, ChargeRow } from "./charge.repository";
import { CreatePaymentInput, ConfirmPaymentInput, CapturePaymentInput, CancelPaymentInput } from "./payment.schema";
import { authorize } from "./acquirer";
import { postLedgerTransaction } from "../ledger/ledger.repository";
import { OutboxRepository } from "../outbox/outbox.repository";
import { toPaymentView } from "./payment.view";

export interface PaymentWithCharges {
  payment: PaymentRow;
  charges: ChargeRow[];
}

export interface PaymentService {
  create(merchantId: number, input: CreatePaymentInput): Promise<PaymentWithCharges>;
  get(merchantId: number, publicId: string): Promise<PaymentWithCharges>;
  list(merchantId: number, limit: number, status?: string): Promise<PaymentWithCharges[]>;
  confirm(merchantId: number, publicId: string, input: ConfirmPaymentInput): Promise<PaymentWithCharges>;
  capture(merchantId: number, publicId: string, input: CapturePaymentInput): Promise<PaymentWithCharges>;
  cancel(merchantId: number, publicId: string, input: CancelPaymentInput): Promise<PaymentWithCharges>;
}

function feeSplit(amount: number): { merchantAmount: number; feeAmount: number } {
  const feeAmount = Math.floor((amount * env.PLATFORM_FEE_BPS) / 10000);
  return { merchantAmount: amount - feeAmount, feeAmount };
}

export function createPaymentService(
  pool: Pool,
  paymentRepository: PaymentRepository,
  chargeRepository: ChargeRepository,
  outboxRepository: OutboxRepository,
): PaymentService {
  async function loadWithCharges(payment: PaymentRow, executor: Queryable): Promise<PaymentWithCharges> {
    const charges = await chargeRepository.listByPaymentId(payment.id, executor);
    return { payment, charges };
  }

  async function lockOrThrow(merchantId: number, publicId: string, client: Queryable): Promise<PaymentRow> {
    const payment = await paymentRepository.lockByPublicIdAndMerchantId(publicId, merchantId, client);
    if (!payment) {
      throw new ResourceNotFoundError(`No such payment: ${publicId}`);
    }
    return payment;
  }

  return {
    async create(merchantId, input) {
      const payment = await paymentRepository.insert({
        publicId: generatePublicId("pay_"),
        merchantId,
        amount: input.amount,
        currency: input.currency,
        captureMethod: input.capture_method ?? "automatic",
        description: input.description,
        metadata: input.metadata ?? {},
      });
      await outboxRepository.append(merchantId, "payment.created", toPaymentView(payment), pool);
      return { payment, charges: [] };
    },

    async get(merchantId, publicId) {
      const payment = await paymentRepository.findByPublicIdAndMerchantId(publicId, merchantId);
      if (!payment) {
        throw new ResourceNotFoundError(`No such payment: ${publicId}`);
      }
      return loadWithCharges(payment, pool);
    },

    async list(merchantId, limit, status) {
      const payments = await paymentRepository.list(merchantId, limit, status, pool);
      const charges = await chargeRepository.listByPaymentIds(payments.map((p) => p.id), pool);
      const chargesByPayment = new Map<number, ChargeRow[]>();
      for (const charge of charges) {
        const list = chargesByPayment.get(charge.payment_id) ?? [];
        list.push(charge);
        chargesByPayment.set(charge.payment_id, list);
      }
      return payments.map((payment) => ({ payment, charges: chargesByPayment.get(payment.id) ?? [] }));
    },

    async confirm(merchantId, publicId, input) {
      return withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        if (payment.status !== "requires_confirmation") {
          throw new IllegalTransitionError(`This payment has status '${payment.status}' and cannot be confirmed.`);
        }

        const outcome = authorize(input.payment_method);
        const charge = await chargeRepository.insert(
          {
            publicId: generatePublicId("ch_"),
            paymentId: payment.id,
            amount: payment.amount,
            currency: payment.currency,
            status: outcome.approved ? "succeeded" : "failed",
            paymentMethod: input.payment_method,
            acquirerReference: outcome.acquirerReference,
            failureCode: outcome.failureCode,
            failureMessage: outcome.failureMessage,
          },
          client,
        );

        let updated: PaymentRow | null;
        let eventType: "payment.failed" | "payment.requires_capture" | "payment.succeeded";

        if (!outcome.approved) {
          updated = await paymentRepository.applyChargeOutcome(
            payment.id,
            ["requires_confirmation"],
            { status: "requires_confirmation", latestChargeId: charge.id },
            client,
          );
          eventType = "payment.failed";
        } else if (payment.capture_method === "manual") {
          updated = await paymentRepository.applyChargeOutcome(
            payment.id,
            ["requires_confirmation"],
            {
              status: "requires_capture",
              latestChargeId: charge.id,
              captureExpiresAt: new Date(Date.now() + env.HOLD_EXPIRY_SECONDS * 1000),
            },
            client,
          );
          eventType = "payment.requires_capture";
        } else {
          // automatic capture: authorize and capture in the same step, so the ledger is written
          // here too — see capture() for why the split entries look the way they do.
          const { merchantAmount, feeAmount } = feeSplit(payment.amount);
          await writeCaptureLedgerEntries(client, payment, merchantAmount, feeAmount, charge.id);
          updated = await paymentRepository.applyChargeOutcome(
            payment.id,
            ["requires_confirmation"],
            { status: "succeeded", latestChargeId: charge.id, amountCaptured: payment.amount },
            client,
          );
          eventType = "payment.succeeded";
        }

        if (!updated) {
          // Row was locked and checked above, so this only happens if something else in this
          // same transaction moved it — a bug, not a race (the FOR UPDATE lock rules races out).
          throw new IllegalTransitionError(`This payment has status '${payment.status}' and cannot be confirmed.`);
        }

        const view = await loadWithCharges(updated, client);
        await outboxRepository.append(merchantId, eventType, toPaymentView(view.payment, view.charges), client);
        return view;
      });
    },

    async capture(merchantId, publicId, input) {
      return withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        if (payment.status !== "requires_capture") {
          throw new IllegalTransitionError(`This payment has status '${payment.status}' and cannot be captured.`);
        }

        const amountToCapture = input.amount_to_capture ?? payment.amount;
        if (amountToCapture > payment.amount) {
          throw new InvalidRequestError("amount_to_capture cannot exceed the authorized amount.", "amount_to_capture");
        }

        const { merchantAmount, feeAmount } = feeSplit(amountToCapture);
        await writeCaptureLedgerEntries(client, payment, merchantAmount, feeAmount, payment.latest_charge_id ?? undefined, amountToCapture);

        const updated = await paymentRepository.applyCapture(payment.id, ["requires_capture"], amountToCapture, client);
        if (!updated) {
          throw new IllegalTransitionError(`This payment has status '${payment.status}' and cannot be captured.`);
        }

        const view = await loadWithCharges(updated, client);
        await outboxRepository.append(merchantId, "payment.succeeded", toPaymentView(view.payment, view.charges), client);
        return view;
      });
    },

    async cancel(merchantId, publicId, input) {
      return withTransaction(pool, async (client) => {
        const payment = await lockOrThrow(merchantId, publicId, client);
        const legalFrom = ["requires_confirmation", "requires_capture"];
        if (!legalFrom.includes(payment.status)) {
          throw new IllegalTransitionError(
            `This payment has status '${payment.status}' and cannot be canceled. A succeeded payment must be refunded instead.`,
          );
        }

        const updated = await paymentRepository.applyCancel(payment.id, legalFrom, input.cancellation_reason ?? null, client);
        if (!updated) {
          throw new IllegalTransitionError(`This payment has status '${payment.status}' and cannot be canceled.`);
        }

        const view = await loadWithCharges(updated, client);
        await outboxRepository.append(merchantId, "payment.canceled", toPaymentView(view.payment, view.charges), client);
        return view;
      });
    },
  };

  // The one place capture's ledger entries are written, shared by confirm() (automatic capture)
  // and capture() (manual capture) — see openapi/bifrost.v1.yaml#capturePayment: "the capture
  // transaction debits acquirer_receivable and credits merchant_payable_pending plus
  // platform_fee_revenue, balanced, in the same database transaction as the status change."
  // Zero-amount legs are omitted rather than written as a $0 entry, since ledger_entries.amount
  // has a CHECK (amount > 0) — a 100%-fee or 0-fee capture is legal and shouldn't fail on that.
  async function writeCaptureLedgerEntries(
    client: Queryable,
    payment: PaymentRow,
    merchantAmount: number,
    feeAmount: number,
    chargeId: number | undefined,
    capturedAmount: number = payment.amount,
  ) {
    const maturesAt = new Date(Date.now() + env.PAYOUT_MATURITY_SECONDS * 1000);
    await postLedgerTransaction(client, [
      {
        accountType: "acquirer_receivable",
        merchantId: null,
        direction: "debit",
        amount: capturedAmount,
        currency: payment.currency,
        paymentId: payment.id,
        chargeId,
      },
      ...(merchantAmount > 0
        ? [
            {
              accountType: "merchant_payable_pending" as const,
              merchantId: payment.merchant_id,
              direction: "credit" as const,
              amount: merchantAmount,
              currency: payment.currency,
              paymentId: payment.id,
              chargeId,
              maturesAt,
            },
          ]
        : []),
      ...(feeAmount > 0
        ? [
            {
              accountType: "platform_fee_revenue" as const,
              merchantId: null,
              direction: "credit" as const,
              amount: feeAmount,
              currency: payment.currency,
              paymentId: payment.id,
              chargeId,
            },
          ]
        : []),
    ]);
  }
}
