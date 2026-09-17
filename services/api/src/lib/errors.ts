// "No such object, or it belongs to another merchant" — deliberately indistinguishable, per the
// spec. Every by-id lookup in the API (payments, refunds, events, keys, ...) throws this the
// same way, mapped to 404 centrally in middleware/errorHandler.ts.
export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}

// Thrown whenever a status transition is attempted from a status that doesn't legally permit
// it (confirming a succeeded payment, capturing a canceled one, ...) — mapped to 409
// payment_unexpected_state centrally in middleware/errorHandler.ts, mirroring IllegalTransition
// in the OpenAPI spec.
export class IllegalTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalTransitionError";
  }
}

// A validation failure that depends on other request/object state, not the request body shape
// alone — e.g. amount_to_capture exceeding the authorized amount — so zod can't catch it at
// the schema layer. Maps to 400 invalid_request_error, same envelope as a zod failure.
export class InvalidRequestError extends Error {
  param?: string;
  constructor(message: string, param?: string) {
    super(message);
    this.name = "InvalidRequestError";
    this.param = param;
  }
}
