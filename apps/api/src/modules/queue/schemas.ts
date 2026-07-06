import { z } from "zod";

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const roomIdParam = z.object({ roomId: z.coerce.number().int().positive() });
export const challengeIdParam = z.object({ challengeId: z.coerce.number().int().positive() });
export const entryIdParam = z.object({ entryId: z.coerce.number().int().positive() });
export const roomChallengeParam = z.object({
  roomId: z.coerce.number().int().positive(),
  challengeId: z.coerce.number().int().positive(),
});
export const roomJudgeParam = z.object({
  roomId: z.coerce.number().int().positive(),
  challengeId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

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

export const assignChallengeBody = z.object({ challengeId: z.coerce.number().int().positive() });
export const assignJudgeBody = z.object({
  challengeId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

export const roomQueueStateBody = z.object({
  desiredMinutesPerTeam: z.coerce.number().int().min(1).optional(),
});

export const queueSettingsBody = z.object({
  handoffBufferMinutes: z.coerce.number().int().min(0).optional(),
  scheduleStartAt: z.coerce.date().optional().nullable(),
  scheduleEndAt: z.coerce.date().optional().nullable(),
  preCallNotificationEtaMinutes: z.coerce.number().int().min(0).optional(),
  requeuePromptDefault: z.enum(["top", "bottom", "ask"]).optional(),
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

export const tvModeBody = z.object({
  mode: z.enum(["rooms", "schedule", "sponsors", "announcement", "wifi", "timer"]),
  payload: z.unknown().optional(),
});
