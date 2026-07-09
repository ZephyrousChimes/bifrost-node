import { randomInt } from "node:crypto";

// mer_..., key_..., pay_..., sk_test_... — every prefixed public id in the app comes from here.
// randomInt is CSPRNG-backed (rejection sampling over a random byte stream), the equivalent of
// Java's SecureRandom.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generatePublicId(prefix: string): string {
  let id = prefix;
  for (let i = 0; i < 24; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}
