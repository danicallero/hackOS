import {
  LIVE_ACTIVITY_KINDS,
  LIVE_ACTIVITY_PROPS_VERSION,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
} from "@hackos/shared/live-activities";
import { LANGS } from "@hackos/shared/locale";
import { z } from "zod";

/** Live Activity registry and read schemas (#966; H38, H25, H26). */

const languageSchema = z.enum(LANGS as [string, ...string[]]);
const kindSchema = z.enum([LIVE_ACTIVITY_KINDS.QUEUE, LIVE_ACTIVITY_KINDS.ACTIVITY]);
const deviceIdSchema = z.string().trim().min(1).max(200);
const tokenSchema = z.string().trim().min(1).max(500);

export const upsertDeviceBodySchema = z.object({
  deviceId: deviceIdSchema,
  platform: z.enum(["ios", "android"]),
  /** iOS 17.2+ ActivityKit push-to-start token (hex). Omit to keep, null to clear. */
  pushToStartToken: tokenSchema.nullable().optional(),
  /** Expo push token used for Android data-only Live Update pushes. Omit to keep, null to clear. */
  expoPushToken: tokenSchema.nullable().optional(),
  /** Language of the Live Activity labels; null falls back to the account language. */
  language: languageSchema.nullable().optional(),
  /** Per-device opt-out. Omit to keep (new devices start enabled). */
  enabled: z.boolean().optional(),
});

export const deviceResponseSchema = z.object({
  deviceId: z.string(),
  platform: z.enum(["ios", "android"]),
  enabled: z.boolean(),
  language: languageSchema.nullable(),
});

const sessionKeyShape = {
  deviceId: deviceIdSchema,
  kind: kindSchema,
  /** `judging` for the queue activity, `activity:<id>` for a staff activity. */
  subject: z.string().trim().min(1).max(100),
};

function subjectMatchesKind(v: { kind: string; subject: string }): boolean {
  return v.kind === LIVE_ACTIVITY_KINDS.QUEUE
    ? v.subject === QUEUE_LIVE_ACTIVITY_SUBJECT
    : /^activity:[1-9]\d{0,9}$/.test(v.subject);
}

const subjectRule = {
  message: `subject must be "${QUEUE_LIVE_ACTIVITY_SUBJECT}" for queue or "activity:<id>" for activity`,
  path: ["subject"],
};

export const upsertSessionBodySchema = z
  .object({
    ...sessionKeyShape,
    /** iOS per-activity push token; null/omitted on Android (no per-activity token). */
    activityPushToken: tokenSchema.nullable().optional(),
  })
  .refine(subjectMatchesKind, subjectRule);

export const endSessionBodySchema = z
  .object({
    ...sessionKeyShape,
    /** Phase the activity showed when dismissed; it comes back only in another phase. */
    phase: z.enum(["waiting", "called", "in_room", "upcoming", "live"]).optional(),
  })
  .refine(subjectMatchesKind, subjectRule);

export const statusResponseSchema = z.object({ status: z.literal(true) });

export const myLiveActivitiesQuerySchema = z.object({
  /** Label language; defaults to the account language. */
  language: languageSchema.optional(),
});

const queueLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("queue"),
  phase: z.enum(["waiting", "called", "in_room"]),
  entryId: z.number().int(),
  challengeTitle: z.string(),
  position: z.number().int().nullable(),
  etaMinutes: z.number().int().nullable(),
  roomName: z.string().nullable(),
  roomLocation: z.string().nullable(),
  otherQueues: z.number().int(),
  url: z.string(),
  labels: z.object({
    position: z.string(),
    wait: z.string(),
    goTo: z.string(),
    inRoom: z.string(),
    moreQueues: z.string().nullable(),
    minutes: z.string(),
  }),
  updatedAt: z.string(),
});

const activityLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("activity"),
  phase: z.enum(["upcoming", "live"]),
  activityId: z.number().int(),
  name: z.string(),
  category: z.string(),
  location: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  scanned: z.number().int(),
  scanUrl: z.string(),
  url: z.string(),
  labels: z.object({ startsIn: z.string(), scanned: z.string(), scan: z.string() }),
  updatedAt: z.string(),
});

export const myLiveActivitiesResponseSchema = z.object({
  judgingWindowOpen: z.boolean(),
  queue: queueLivePropsSchema.nullable(),
  activities: z.array(activityLivePropsSchema),
});
