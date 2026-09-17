import cors from "cors";
import express from "express";
import { pool } from "./db/pool";
import { apiKeyAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { createApiKeyRepository } from "./merchant/api-key.repository";
import { createMerchantRepository } from "./merchant/merchant.repository";
import { createMerchantRoutes } from "./merchant/merchant.routes";
import { createMerchantService } from "./merchant/merchant.service";
import { createPaymentRepository } from "./payment/payment.repository";
import { createPaymentRoutes } from "./payment/payment.routes";
import { createPaymentService } from "./payment/payment.service";
import { createChargeRepository } from "./payment/charge.repository";
import { createRefundRepository } from "./refund/refund.repository";
import { createRefundRoutes } from "./refund/refund.routes";
import { createRefundService } from "./refund/refund.service";
import { createOutboxRepository } from "./outbox/outbox.repository";
import { createIdempotencyRepository } from "./idempotency/idempotency.repository";
import { createBalanceRoutes } from "./balance/balance.routes";
import { createEventRoutes } from "./event/event.routes";

// The composition root: the one place the dependency graph is built by hand — Node's
// stand-in for Spring's ApplicationContext. Nothing outside this function reaches for a
// global singleton.
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // The dashboard is a separate origin (Next.js dev server, typically :3000) calling this API
  // (:8080) directly from the browser with a merchant's own secret key in the Authorization
  // header -- CORS has to explicitly allow that header, or the browser blocks it before the
  // request ever reaches apiKeyAuth.
  app.use(cors({ origin: true, allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] }));
  app.use(express.json());

  const merchantRepository = createMerchantRepository(pool);
  const apiKeyRepository = createApiKeyRepository(pool);
  const merchantService = createMerchantService(pool, merchantRepository, apiKeyRepository);

  const paymentRepository = createPaymentRepository(pool);
  const chargeRepository = createChargeRepository();
  const outboxRepository = createOutboxRepository();
  const idempotencyRepository = createIdempotencyRepository();
  const paymentService = createPaymentService(pool, paymentRepository, chargeRepository, outboxRepository);

  const refundRepository = createRefundRepository(pool);
  const refundService = createRefundService(pool, paymentRepository, refundRepository, outboxRepository);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Mounted at the app level, ahead of routing, mirroring the filter chain running ahead of
  // Spring's dispatcher servlet.
  app.use(apiKeyAuth(apiKeyRepository));

  app.use("/v1", createMerchantRoutes(merchantService));
  app.use("/v1", createPaymentRoutes(paymentService, idempotencyRepository));
  app.use("/v1", createRefundRoutes(refundService, idempotencyRepository));
  app.use("/v1", createBalanceRoutes(pool));
  app.use("/v1", createEventRoutes(outboxRepository, pool));

  // Must be registered last — Express identifies error middleware by its four-argument arity.
  app.use(errorHandler);

  return app;
}
