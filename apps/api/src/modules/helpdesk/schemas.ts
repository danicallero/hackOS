import { z } from "zod";

// H61-H67 help desk request schemas. Free text is trimmed; control
// characters are refused (descriptions keep line breaks).
const CONTROL = /\p{Cc}/u;
function line(max: number) {
  return z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .refine((v) => v.length >= 1, { message: "Required" })
    .refine((v) => v.length <= max, { message: `Must be at most ${max} characters` })
    .refine((v) => !CONTROL.test(v), { message: "Must not contain control characters" });
}
const multiline = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\r\n?/g, "\n").trim())
    .refine((v) => v.length >= 1, { message: "Required" })
    .refine((v) => v.length <= max, { message: `Must be at most ${max} characters` })
    .refine((v) => !/[^\P{Cc}\n]/u.test(v), { message: "Must not contain control characters" });

const id = z.coerce.number().int().positive();
const instant = z.string().datetime({ offset: true });

export const idParams = z.object({ id });
export const userParams = z.object({ userId: id });

export const topicQuery = z.object({
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Request forms: only topics offered by published helpers who are in the venue now. */
  available: z.enum(["1", "true"]).optional(),
});
export const topicBody = z.object({ name: line(60) });
export const mergeBody = z.object({ targetId: id });

export const helperProfileBody = z.strictObject({
  published: z.boolean(),
  topicIds: z.array(id).max(20),
  challengeIds: z.array(id).max(50).optional(),
});
export type HelperProfileInput = z.infer<typeof helperProfileBody>;

export const availabilityBody = z.object({
  intervals: z.array(z.object({ startsAt: instant, endsAt: instant })).max(30),
});
export type AvailabilityInput = z.infer<typeof availabilityBody>;

export const scheduleBody = z.strictObject({
  eventAccessOnly: z.boolean().optional(),
  windows: z
    .array(
      z
        .object({ startsAt: instant, endsAt: instant })
        .refine((w) => Date.parse(w.endsAt) > Date.parse(w.startsAt), {
          message: "Must end after it starts",
          path: ["endsAt"],
        }),
    )
    .max(30),
});
export type ScheduleInput = z.infer<typeof scheduleBody>;

export const helperQuery = z.object({
  topicId: id.optional(),
  q: z.string().trim().max(80).optional(),
  availableNow: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const createRequestBody = z
  .object({
    description: multiline(500),
    location: line(120),
    topicIds: z.array(id).max(5),
    other: z.boolean(),
    /** H64: an active project membership makes this a team request. */
    projectId: id.nullable().optional(),
    challengeId: id.nullable().optional(),
    preferSponsor: z.boolean().default(false),
  })
  .refine((v) => v.other || v.topicIds.length > 0, {
    message: "Choose at least one topic or Other",
    path: ["topicIds"],
  })
  .refine((v) => !v.preferSponsor || v.challengeId != null, {
    message: "Choose a challenge before preferring its sponsor",
    path: ["challengeId"],
  });
export type CreateRequestInput = z.infer<typeof createRequestBody>;

/** H64: editing an open request replaces its content with the creation rules. */
export const editRequestBody = z
  .object({
    description: multiline(500),
    location: line(120),
    topicIds: z.array(id).max(5),
    other: z.boolean(),
    challengeId: id.nullable().optional(),
    preferSponsor: z.boolean().default(false),
  })
  .refine((v) => v.other || v.topicIds.length > 0, {
    message: "Choose at least one topic or Other",
    path: ["topicIds"],
  })
  .refine((v) => !v.preferSponsor || v.challengeId != null, {
    message: "Choose a challenge before preferring its sponsor",
    path: ["challengeId"],
  });
export type EditRequestInput = z.infer<typeof editRequestBody>;

export const claimBody = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("on_my_way") }),
  z.object({ mode: z.literal("meet_at"), meetingLocation: line(120) }),
]);
export type ClaimInput = z.infer<typeof claimBody>;

export const inboxQuery = z.object({ scope: z.enum(["open", "mine"]).default("open") });

export const coverageQuery = z.object({
  from: instant.optional(),
  to: instant.optional(),
  stepMinutes: z.coerce.number().int().min(15).max(240).default(60),
});
