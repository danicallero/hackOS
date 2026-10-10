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

// #935: a bio keeps its line breaks; every other control character is refused.
const bioText = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .refine((value) => value.length <= 500, { message: "Must be at most 500 characters" })
  .refine((value) => !/[^\P{Cc}\n]/u.test(value), {
    message: "Must not contain control characters",
  })
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const SOCIAL_KINDS = ["linkedin", "github", "x", "instagram", "website", "other"] as const;
export const SOCIALS_MAX = 6;

/**
 * #935: links are https only. A bare host gets `https://`; the stored value
 * is the parsed URL's canonical form, so duplicates compare equal.
 */
const socialUrl = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    } catch {
      ctx.addIssue({ code: "custom", message: "Must be a valid https link" });
      return z.NEVER;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname.includes(".") ||
      url.href.length > 300
    ) {
      ctx.addIssue({ code: "custom", message: "Must be a valid https link" });
      return z.NEVER;
    }
    return url.href;
  });

export const socialLink = z.object({ kind: z.enum(SOCIAL_KINDS), url: socialUrl });
export type SocialLink = z.infer<typeof socialLink>;

const socials = z
  .array(socialLink)
  .max(SOCIALS_MAX)
  .refine((links) => new Set(links.map((link) => link.url)).size === links.length, {
    message: "Each link may appear only once",
  });

export const publicProfileBody = z.object({
  directoryVisible: z.boolean(),
  showSurname: z.boolean(),
  showPhoto: z.boolean(),
  showProject: z.boolean(),
  headline: publicText(80),
  locationNote: publicText(60),
  // #935: omitted keeps the stored value, so older clients replace only what they know.
  bio: bioText.optional(),
  socials: socials.optional(),
  shareCv: z.boolean().optional(),
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
