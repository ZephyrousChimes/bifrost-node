// "No such object, or it belongs to another merchant" — deliberately indistinguishable, per the
// spec. Every by-id lookup in the API (payments, refunds, events, keys, ...) throws this the
// same way, mapped to 404 centrally in middleware/errorHandler.ts.
export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceNotFoundError";
  }
}
