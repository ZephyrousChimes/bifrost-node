import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380"),

  // Basis points retained as the platform fee on every capture (290 = 2.9%), matching the
  // "platform fee retained by default" behaviour the refund endpoint documents.
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(290),

  // How long an authorization holds before the sweeper cancels it. Real PSPs use ~7 days;
  // short here so the sweeper's behaviour is actually observable in a demo/test run.
  HOLD_EXPIRY_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
  // How long captured funds sit in `pending` before the payout sweeper matures them to
  // `available`. Same reasoning: short by default, overridable for a realistic value.
  PAYOUT_MATURITY_SECONDS: z.coerce.number().int().positive().default(2 * 24 * 60 * 60),

  OUTBOX_RELAY_POLL_MS: z.coerce.number().int().positive().default(2000),
  SWEEPER_POLL_MS: z.coerce.number().int().positive().default(5000),
});

export const env = EnvSchema.parse(process.env);
