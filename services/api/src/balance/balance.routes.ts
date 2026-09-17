import { Pool } from "pg";
import { Router } from "express";
import { computeMerchantBalance } from "../ledger/ledger.repository";

// Balance has no repository/service split of its own -- it's a read-only projection of the
// ledger, not an owned resource, so the query lives directly against ledger.repository.ts
// rather than behind an extra layer that would just forward the call.
export function createBalanceRoutes(pool: Pool): Router {
  const router = Router();

  router.get("/balance", async (req, res) => {
    const rows = await computeMerchantBalance(pool, req.merchantId!);
    res.json({
      object: "balance",
      pending: rows.map((r) => ({ amount: r.pending, currency: r.currency })),
      available: rows.map((r) => ({ amount: r.available, currency: r.currency })),
    });
  });

  return router;
}
