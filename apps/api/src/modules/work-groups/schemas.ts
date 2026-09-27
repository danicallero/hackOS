import { z } from "zod";

export const groupParams = z.object({ id: z.coerce.number().int().positive() });
export const createGroupBody = z.object({ name: z.string().trim().min(1).max(200) });
export const updateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10000).optional(),
    devpostUrl: z.string().url().max(2000).nullable().optional(),
    githubUrl: z.string().url().max(2000).nullable().optional(),
    demoUrl: z.string().url().max(2000).nullable().optional(),
    presentationTimingPreference: z.enum(["no_preference", "early", "middle", "late"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one field is required",
  });
export const inviteBody = z.object({
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase()),
});
export const challengeBody = z.object({ challengeId: z.number().int().positive() });
