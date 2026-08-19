import { z } from "zod";

export const CreatePaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  capture_method: z.enum(["automatic", "manual"]).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  description: z.string().max(1000).optional(),
});
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;
