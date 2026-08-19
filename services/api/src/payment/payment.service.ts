import { generatePublicId } from "../lib/publicId";
import { ResourceNotFoundError } from "../lib/errors";
import { PaymentRepository, PaymentRow } from "./payment.repository";
import { CreatePaymentInput } from "./payment.schema";

export interface PaymentService {
  create(merchantId: number, input: CreatePaymentInput): Promise<PaymentRow>;
  get(merchantId: number, publicId: string): Promise<PaymentRow>;
}

export function createPaymentService(paymentRepository: PaymentRepository): PaymentService {
  return {
    async create(merchantId, input) {
      return paymentRepository.insert({
        publicId: generatePublicId("pay_"),
        merchantId,
        amount: input.amount,
        currency: input.currency,
        captureMethod: input.capture_method ?? "automatic",
        description: input.description,
        metadata: input.metadata ?? {},
      });
    },

    async get(merchantId, publicId) {
      const payment = await paymentRepository.findByPublicIdAndMerchantId(publicId, merchantId);
      if (!payment) {
        throw new ResourceNotFoundError(`No such payment: ${publicId}`);
      }
      return payment;
    },
  };
}
