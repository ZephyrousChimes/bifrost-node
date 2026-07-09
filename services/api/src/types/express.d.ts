// Node's equivalent of Spring's request-attribute-plus-CurrentMerchant pair: the auth
// middleware resolves the caller's merchant id once, and every downstream handler reads it
// straight off `req` instead of re-deriving it.
declare global {
  namespace Express {
    interface Request {
      merchantId?: number;
    }
  }
}

export {};
