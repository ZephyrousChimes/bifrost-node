import { Pool } from "pg";
import { Router } from "express";
import { OutboxRepository } from "../outbox/outbox.repository";
import { ResourceNotFoundError } from "../lib/errors";
import { toEventView } from "./event.view";

export function createEventRoutes(outboxRepository: OutboxRepository, pool: Pool): Router {
  const router = Router();

  router.get("/events", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const events = await outboxRepository.listByMerchant(req.merchantId!, limit, pool);
    res.json({ object: "list", data: events.map(toEventView), has_more: events.length === limit });
  });

  router.get("/events/:id", async (req, res) => {
    const event = await outboxRepository.findByPublicIdAndMerchantId(req.params.id, req.merchantId!, pool);
    if (!event) {
      throw new ResourceNotFoundError(`No such event: ${req.params.id}`);
    }
    res.json(toEventView(event));
  });

  return router;
}
