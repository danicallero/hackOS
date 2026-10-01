import { z } from "zod";

const devpostProjectUrl = z
  .string()
  .url()
  .max(2000)
  .regex(
    /^https?:\/\/([a-z0-9-]+\.)?devpost\.com\/(software|submissions)\/[^/?#]+\/?(?:[?#].*)?$/i,
    "Must be a Devpost project URL",
  );

export const groupParams = z.object({ id: z.coerce.number().int().positive() });
export const createGroupBody = z.object({
  name: z.string().trim().min(1).max(200),
  challengeIds: z.array(z.number().int().positive()).max(50).default([]),
});
export const updateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10000).optional(),
    devpostUrl: devpostProjectUrl.nullable().optional(),
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
