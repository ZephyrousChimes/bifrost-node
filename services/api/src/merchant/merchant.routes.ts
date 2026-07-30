import { Router } from "express";
import { MerchantService } from "./merchant.service";
import { CreateApiKeySchema, CreateMerchantSchema } from "./merchant.schema";
import { toApiKeyView, toMerchantView } from "./merchant.view";

export function createMerchantRoutes(merchantService: MerchantService): Router {
  const router = Router();

  router.post("/merchants", async (req, res) => {
    const input = CreateMerchantSchema.parse(req.body);
    const registration = await merchantService.register(input.name, input.email);
    res.status(201).json({
      merchant: toMerchantView(registration.merchant),
      api_key: toApiKeyView(registration.apiKey, registration.secretKey),
    });
  });

  router.post("/merchant/api_keys", async (req, res) => {
    const input = CreateApiKeySchema.parse(req.body);
    const minted = await merchantService.mintApiKey(req.merchantId!, input?.livemode ?? false);
    res.status(201).json(toApiKeyView(minted.apiKey, minted.secretKey));
  });

  router.post("/merchant/api_keys/:id/revoke", async (req, res) => {
    const apiKey = await merchantService.revokeApiKey(req.merchantId!, req.params.id);
    res.json(toApiKeyView(apiKey));
  });

  return router;
}
