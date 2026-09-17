import { generatePublicId } from "../lib/publicId";

// The simulated acquirer: the test payment_method token *is* the fixture. This is how the spec
// documents failure injection without any real card data ever existing in the system.
export interface AcquirerResult {
  approved: boolean;
  acquirerReference?: string;
  failureCode?: string;
  failureMessage?: string;
}

const DECLINE_OUTCOMES: Record<string, { failureCode: string; failureMessage: string }> = {
  pm_card_declined: { failureCode: "card_declined", failureMessage: "The card was declined." },
  pm_card_insufficient_funds: { failureCode: "insufficient_funds", failureMessage: "The card has insufficient funds." },
  pm_card_expired: { failureCode: "expired_card", failureMessage: "The card has expired." },
  pm_card_incorrect_cvc: { failureCode: "incorrect_cvc", failureMessage: "The CVC is incorrect." },
  pm_card_processing_error: { failureCode: "processing_error", failureMessage: "An error occurred while processing the card." },
  pm_card_acquirer_timeout: { failureCode: "acquirer_timeout", failureMessage: "The acquirer did not respond in time." },
};

const APPROVED_TOKENS = new Set(["pm_card_visa", "pm_card_mastercard"]);

export function authorize(paymentMethod: string): AcquirerResult {
  if (APPROVED_TOKENS.has(paymentMethod)) {
    return { approved: true, acquirerReference: generatePublicId("acq_") };
  }
  const outcome = DECLINE_OUTCOMES[paymentMethod];
  if (outcome) {
    return { approved: false, ...outcome };
  }
  // Any other token is treated as an unrecognized-but-syntactically-valid card, same as
  // pm_card_declined -- the enum in the OpenAPI schema is what actually constrains input at the
  // HTTP boundary (payment.schema.ts), this is just defense in depth.
  return { approved: false, failureCode: "card_declined", failureMessage: "The card was declined." };
}
