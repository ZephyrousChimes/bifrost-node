import { OutboxEventRow } from "../outbox/outbox.repository";

export function toEventView(event: OutboxEventRow) {
  return {
    id: event.public_id,
    object: "event",
    type: event.type,
    created_at: event.created_at,
    data: { object: event.payload },
  };
}
