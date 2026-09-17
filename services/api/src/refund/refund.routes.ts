import { Router } from "express";
import { RefundService } from "./refund.service";
import { CreateRefundSchema } from "./refund.schema";
import { toRefundView } from "./refund.view";
import { idempotent } from "../idempotency/idempotency.middleware";
import { IdempotencyRepository } from "../idempotency/idempotency.repository";

export function createRefundRoutes(refundService: RefundService, idempotencyRepository: IdempotencyRepository): Router {
  const router = Router();

  router.post(
    "/refunds",
    idempotent(idempotencyRepository, async (req) => {
      const input = CreateRefundSchema.parse(req.body);
      const { refund, paymentPublicId } = await refundService.create(req.merchantId!, input);
      return { status: 201, body: toRefundView(refund, paymentPublicId) };
    }),
  );

  router.get("/refunds/:id", async (req, res) => {
    const { refund, paymentPublicId } = await refundService.get(req.merchantId!, req.params.id);
    res.json(toRefundView(refund, paymentPublicId));
  });

  return router;
}
