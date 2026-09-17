import { z } from "zod";

export const CreateRefundSchema = z.object({
  payment: z.string().min(1),
  amount: z.number().int().positive().optional(),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
});
export type CreateRefundInput = z.infer<typeof CreateRefundSchema>;
