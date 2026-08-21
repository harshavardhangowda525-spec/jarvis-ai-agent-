import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  details: z.string().max(4000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  dueAt: z.string().datetime().optional().nullable(),
});

export const noteInputSchema = z.object({
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1).max(20000),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export const memoryInputSchema = z.object({
  key: z.string().trim().max(80).optional(),
  content: z.string().trim().min(1).max(4000),
});

export const agentRequestSchema = z.object({
  conversationId: z.string().cuid().optional().nullable(),
  message: z.string().trim().min(1).max(8000),
  // Client may confirm a previously-requested destructive action.
  confirm: z
    .object({
      token: z.string(),
      approved: z.boolean(),
    })
    .optional(),
});

export const ttsSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});
