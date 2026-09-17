import { createHmac, timingSafeEqual } from "node:crypto";

// Bifrost-Signature: t=<unix seconds>,v1=<hex hmac-sha256> over "{timestamp}.{body}" — the
// scheme the OpenAPI spec's webhooks section documents.
export function signWebhookPayload(secret: string, body: string, timestamp: number = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return { header: `t=${timestamp},v1=${signature}`, timestamp, signature };
}

export function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  const givenSig = parts.v1;
  if (!timestamp || !givenSig) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const { signature: expected } = signWebhookPayload(secret, body, timestamp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(givenSig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
