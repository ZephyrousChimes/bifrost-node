import { Router } from "express";
import { PaymentService } from "./payment.service";
import { CreatePaymentSchema } from "./payment.schema";
import { toPaymentView } from "./payment.view";

export function createPaymentRoutes(paymentService: PaymentService): Router {
  const router = Router();

  router.post("/payments", async (req, res) => {
    const input = CreatePaymentSchema.parse(req.body);
    const payment = await paymentService.create(req.merchantId!, input);
    res.status(201).json(toPaymentView(payment));
  });

  router.get("/payments/:id", async (req, res) => {
    const payment = await paymentService.get(req.merchantId!, req.params.id);
    res.json(toPaymentView(payment));
  });

  return router;
}
