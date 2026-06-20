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

// The composition root: the one place the dependency graph is built by hand — Node's
// stand-in for Spring's ApplicationContext. Nothing outside this function reaches for a
// global singleton.
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  const merchantRepository = createMerchantRepository(pool);
  const apiKeyRepository = createApiKeyRepository(pool);
  const merchantService = createMerchantService(pool, merchantRepository, apiKeyRepository);

  const paymentRepository = createPaymentRepository(pool);
  const paymentService = createPaymentService(paymentRepository);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Mounted at the app level, ahead of routing, mirroring the filter chain running ahead of
  // Spring's dispatcher servlet.
  app.use(apiKeyAuth(apiKeyRepository));

  app.use("/v1", createMerchantRoutes(merchantService));
  app.use("/v1", createPaymentRoutes(paymentService));

  // Must be registered last — Express identifies error middleware by its four-argument arity.
  app.use(errorHandler);

  return app;
}
