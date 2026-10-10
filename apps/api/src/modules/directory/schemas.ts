import { z } from "zod";

// #934: free text is trimmed, empty becomes null, control characters are refused.
const CONTROL_CHARACTERS = /\p{Cc}/u;
function publicText(max: number) {
  return z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, { message: `Must be at most ${max} characters` })
    .refine((value) => !CONTROL_CHARACTERS.test(value), {
      message: "Must not contain control characters",
    })
    .transform((value) => (value === "" ? null : value))
    .nullable();
}

export const publicProfileBody = z.object({
  directoryVisible: z.boolean(),
  showSurname: z.boolean(),
  showPhoto: z.boolean(),
  showProject: z.boolean(),
  headline: publicText(80),
  locationNote: publicText(60),
});
export type PublicProfileInput = z.infer<typeof publicProfileBody>;

export const directoryQuery = z.object({
  q: z.string().trim().max(80).optional(),
  challengeId: z.coerce.number().int().positive().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type DirectoryQuery = z.infer<typeof directoryQuery>;

export const userParams = z.object({ userId: z.coerce.number().int().positive() });
export const moderationParams = z.object({ id: z.coerce.number().int().positive() });
export const moderationBody = z.object({ reason: z.string().trim().min(1).max(500) });
