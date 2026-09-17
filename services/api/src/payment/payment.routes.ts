import { Router } from "express";
import { PaymentService } from "./payment.service";
import { CreatePaymentSchema, ConfirmPaymentSchema, CapturePaymentSchema, CancelPaymentSchema } from "./payment.schema";
import { toPaymentView } from "./payment.view";
import { idempotent } from "../idempotency/idempotency.middleware";
import { IdempotencyRepository } from "../idempotency/idempotency.repository";

export function createPaymentRoutes(paymentService: PaymentService, idempotencyRepository: IdempotencyRepository): Router {
  const router = Router();

  router.post(
    "/payments",
    idempotent(idempotencyRepository, async (req) => {
      const input = CreatePaymentSchema.parse(req.body);
      const { payment, charges } = await paymentService.create(req.merchantId!, input);
      return { status: 201, body: toPaymentView(payment, charges) };
    }),
  );

  router.get("/payments/:id", async (req, res) => {
    const { payment, charges } = await paymentService.get(req.merchantId!, req.params.id);
    res.json(toPaymentView(payment, charges));
  });

  router.post(
    "/payments/:id/confirm",
    idempotent(idempotencyRepository, async (req) => {
      const input = ConfirmPaymentSchema.parse(req.body);
      const { payment, charges } = await paymentService.confirm(req.merchantId!, req.params.id as string, input);
      return { status: 200, body: toPaymentView(payment, charges) };
    }),
  );

  router.post(
    "/payments/:id/capture",
    idempotent(idempotencyRepository, async (req) => {
      const input = CapturePaymentSchema.parse(req.body ?? {});
      const { payment, charges } = await paymentService.capture(req.merchantId!, req.params.id as string, input);
      return { status: 200, body: toPaymentView(payment, charges) };
    }),
  );

  router.post(
    "/payments/:id/cancel",
    idempotent(idempotencyRepository, async (req) => {
      const input = CancelPaymentSchema.parse(req.body ?? {});
      const { payment, charges } = await paymentService.cancel(req.merchantId!, req.params.id as string, input);
      return { status: 200, body: toPaymentView(payment, charges) };
    }),
  );

  return router;
}
