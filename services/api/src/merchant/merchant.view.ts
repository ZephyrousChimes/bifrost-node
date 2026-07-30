import { MerchantRow } from "./merchant.repository";
import { ApiKeyRow } from "./api-key.repository";

// Wire shapes for openapi/bifrost.v1.yaml#MerchantRegistration / #ApiKey. Deliberately not the
// rows themselves: secretKey only ever exists here, never persisted, and the JSON shape
// shouldn't move just because a database column does.

export function toMerchantView(merchant: MerchantRow) {
  return {
    id: merchant.public_id,
    object: "merchant",
    name: merchant.name,
    email: merchant.email,
    created_at: merchant.created_at,
  };
}

// secretKey passed only for the one response where a key is minted; omitted (not sent as null)
// everywhere else, matching the spec's two schemas (ApiKey vs ApiKeyWithSecret) from one shape.
export function toApiKeyView(apiKey: ApiKeyRow, secretKey?: string) {
  return {
    id: apiKey.public_id,
    object: "api_key",
    prefix: apiKey.prefix,
    livemode: apiKey.livemode,
    created_at: apiKey.created_at,
    revoked_at: apiKey.revoked_at,
    ...(secretKey !== undefined ? { secret_key: secretKey } : {}),
  };
}
