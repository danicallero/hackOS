import { questionnaireSchema } from "@hackos/shared/questions";
import { z } from "zod";

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const roomIdParam = z.object({ roomId: z.coerce.number().int().positive() });
export const repoIdParam = z.object({ repoId: z.coerce.number().int().positive() });
export const challengeIdParam = z.object({ challengeId: z.coerce.number().int().positive() });
export const entryIdParam = z.object({ entryId: z.coerce.number().int().positive() });
export const createRoomBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  location: z.string().optional(),
});

export const updateRoomBody = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  location: z.string().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

export const assignRoomEnterpriseBody = z.object({
  enterpriseId: z.coerce.number().int().positive(),
});

// ── shared judging queues (H46) ──────────────────────────────────────────────
export const queueGroupIdParam = z.object({
  queueGroupId: z.coerce.number().int().positive(),
});
export const enterpriseQueueGroupParam = z.object({
  id: z.coerce.number().int().positive(),
  queueGroupId: z.coerce.number().int().positive(),
});
export const previewMergeBody = z.object({
  challengeIds: z.array(z.coerce.number().int().positive()).min(1),
});
export const mergeQueueGroupsBody = z.object({
  challengeIds: z.array(z.coerce.number().int().positive()).min(2),
  displayName: z.string().min(1).max(120),
});
export const updateQueueGroupBody = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    criteria: questionnaireSchema.optional(),
  })
  .refine((body) => body.displayName !== undefined || body.criteria !== undefined, {
    message: "Nothing to update",
  });
/** Exactly which rooms serve a queue — the whole set, not a delta. */
export const queueGroupRoomsBody = z.object({
  roomIds: z.array(z.coerce.number().int().positive()),
});

export const roomQueueStateBody = z.object({
  maxInWaitingArea: z.coerce.number().int().min(1).optional(),
  desiredMinutesPerTeam: z.coerce.number().int().min(1).optional(),
});

export const queueSettingsBody = z.object({
  handoffBufferMinutes: z.coerce.number().int().min(0).optional(),
  scheduleStartAt: z.coerce.date().optional().nullable(),
  scheduleEndAt: z.coerce.date().optional().nullable(),
  preCallNotificationEtaMinutes: z.coerce.number().int().min(0).optional(),
  requeuePromptDefault: z.enum(["top", "bottom", "ask"]).optional(),
  // H34/H203: configurable called-too-long warning threshold, replacing the
  // frontend's temporary max(10 min, 2x desired minutes/team) fallback.
  calledTooLongThresholdMinutes: z.coerce.number().int().min(1).optional(),
});

export const enqueueChallengeBody = z.object({
  repoIds: z.array(z.coerce.number().int().positive()).optional(),
});

export const callNextBody = z.object({ force: z.boolean().optional() });
export const reasonBody = z.object({ reason: z.string().optional() });
export const requiredReasonBody = z.object({ reason: z.string().min(1) });
export const requeueBody = z.object({
  position: z.enum(["top", "bottom"]),
  reason: z.string().optional(),
});
/** Move a team to an explicit place in its queue (1-based, clamped). */
export const moveToPositionBody = z.object({
  position: z.coerce.number().int().min(1),
  reason: z.string().optional(),
});

export const manualCallBody = z.object({
  targetStatus: z.enum(["called", "in_room"]),
  roomId: z.coerce.number().int().positive(),
  reason: z.string().optional(),
});

// Answers are typed per the challenge's judging panel (H44): a scale is a
// number, a boolean is a boolean, choices are a string / string[], text is a
// string. Validated against the panel definition in upsertAttemptReview.
const answerValue = z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]);

export const reviewPatchBody = z.object({
  scores: z.record(z.string(), answerValue).optional(),
  notes: z.string().optional(),
  submit: z.boolean().optional(),
});

export const sessionJoinBody = z.object({ roomId: z.coerce.number().int().positive().optional() });

export const searchQuery = z.object({ q: z.string().min(1) });

/** GET /api/queue/reviews(.csv) filters — sponsor-scoping happens server-side. */
export const reviewsQuery = z.object({
  challengeId: z.coerce.number().int().positive().optional(),
  roomId: z.coerce.number().int().positive().optional(),
  status: z.enum(["draft", "submitted", "none"]).optional(),
});

/** POST /api/queue/reviews/:entryId/message — free-text call-back to a team (H46). */
export const reviewMessageBody = z.object({
  message: z.string().min(1).max(1000),
});

/** Every view a screen can show (H42). "live" combines countdown + schedule + sponsors + Wi-Fi. */
export const tvModeName = z.enum(["rooms", "schedule", "sponsors", "wifi", "live"]);

export const tvModeBody = z.object({
  mode: tvModeName,
  payload: z.unknown().optional(),
  // H42 automatic expiry: past this point tv-scheduler.ts drops the override
  // and the timetable takes back over.
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

/**
 * One thing a timetable slot shows. `seconds` is the dwell time and only
 * applies when a slot carries several items (the display rotates through
 * them); a single-item slot ignores it.
 */
export const tvSlotItem = z.object({
  mode: tvModeName,
  payload: z.unknown().optional(),
  seconds: z.coerce.number().int().min(5).max(3600).nullable().optional(),
});

export const tvSlotBody = z.object({
  label: z.string().max(120).nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  items: z.array(tvSlotItem).min(1).max(10),
});

export const tvSlotPatchBody = tvSlotBody.partial();
