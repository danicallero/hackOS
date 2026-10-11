import {
  ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
  DEADLINE_LIVE_ACTIVITY_SUBJECT,
  LIVE_ACTIVITY_CONFIG_KINDS,
  LIVE_ACTIVITY_KINDS,
  LIVE_ACTIVITY_MAX_CONCURRENT_MAX,
  LIVE_ACTIVITY_MAX_CONCURRENT_MIN,
  LIVE_ACTIVITY_PROPS_VERSION,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
} from "@hackos/shared/live-activities";
import { LANGS } from "@hackos/shared/locale";
import { z } from "zod";

/** Live Activity registry, read and configuration schemas (#966; H38, H25, H26, H59, H19, H29-H36, H22). */

const languageSchema = z.enum(LANGS as [string, ...string[]]);
const kindSchema = z.enum(Object.values(LIVE_ACTIVITY_KINDS) as [string, ...string[]]);
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
  /** See `SUBJECT_PATTERNS`. */
  subject: z.string().trim().min(1).max(100),
};

/** The one subject shape each kind uses (`@hackos/shared/live-activities` builds them). */
const SUBJECT_PATTERNS: Record<string, RegExp> = {
  [LIVE_ACTIVITY_KINDS.QUEUE]: new RegExp(`^${QUEUE_LIVE_ACTIVITY_SUBJECT}$`),
  [LIVE_ACTIVITY_KINDS.ACTIVITY]: /^activity:[1-9]\d{0,9}$/,
  [LIVE_ACTIVITY_KINDS.ATTENDEE_ACTIVITY]: /^schedule:[1-9]\d{0,9}$/,
  [LIVE_ACTIVITY_KINDS.DEADLINE]: new RegExp(`^${DEADLINE_LIVE_ACTIVITY_SUBJECT}$`),
  [LIVE_ACTIVITY_KINDS.JUDGING]: /^room:[1-9]\d{0,9}$/,
  [LIVE_ACTIVITY_KINDS.ACCREDITATION]: new RegExp(`^${ACCREDITATION_LIVE_ACTIVITY_SUBJECT}$`),
};

function subjectMatchesKind(v: { kind: string; subject: string }): boolean {
  return SUBJECT_PATTERNS[v.kind]?.test(v.subject) === true;
}

const subjectRule = {
  message:
    'subject must match its kind: queue "judging", activity "activity:<id>", attendee_activity ' +
    '"schedule:<id>", deadline "deadline", judging "room:<id>", accreditation "accreditation"',
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
    phase: z
      .enum([
        "waiting",
        "called",
        "in_room",
        "upcoming",
        "live",
        "open",
        "closing",
        "submitted",
        "presenting",
        "idle",
      ])
      .optional(),
  })
  .refine(subjectMatchesKind, subjectRule);

export const statusResponseSchema = z.object({ status: z.literal(true) });

export const myLiveActivitiesQuerySchema = z.object({
  /** Label language; defaults to the account language. */
  language: languageSchema.optional(),
  /** The caller's own install: the per-device cut then honors its open and dismissed sessions. */
  deviceId: deviceIdSchema.optional(),
});

const rank = z.number().int().optional();
const isoString = z.string();

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
  calledAt: isoString.nullable().optional(),
  startPosition: z.number().int().nullable().optional(),
  otherQueues: z.number().int(),
  url: z.string(),
  labels: z.object({
    position: z.string(),
    wait: z.string(),
    goTo: z.string(),
    inRoom: z.string(),
    moreQueues: z.string().nullable(),
    minutes: z.string(),
    called: z.string().optional(),
    estimating: z.string().optional(),
    stageInLine: z.string().optional(),
    stageCalled: z.string().optional(),
    stageInRoom: z.string().optional(),
  }),
  rank,
  updatedAt: isoString,
});

const activityLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("activity"),
  phase: z.enum(["upcoming", "live"]),
  activityId: z.number().int(),
  name: z.string(),
  category: z.string(),
  location: z.string().nullable(),
  startsAt: isoString,
  endsAt: isoString,
  scanned: z.number().int(),
  inside: z.number().int().nullable().optional(),
  remaining: z.number().int().nullable().optional(),
  scanUrl: z.string(),
  url: z.string(),
  labels: z.object({
    startsIn: z.string(),
    scanned: z.string(),
    scan: z.string(),
    endsIn: z.string().optional(),
    served: z.string().optional(),
    remaining: z.string().optional(),
    inside: z.string().optional(),
  }),
  rank,
  updatedAt: isoString,
});

const attendeeActivityLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("attendee_activity"),
  phase: z.enum(["upcoming", "live"]),
  scheduleId: z.number().int(),
  name: z.string(),
  category: z.string(),
  location: z.string().nullable(),
  startsAt: isoString,
  endsAt: isoString,
  url: z.string(),
  labels: z.object({ startsIn: z.string(), now: z.string(), endsIn: z.string() }),
  rank,
  updatedAt: isoString,
});

const deadlineLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("deadline"),
  phase: z.enum(["open", "closing", "submitted"]),
  startsAt: isoString.nullable(),
  endsAt: isoString,
  submission: z.enum(["submitted", "draft"]).nullable(),
  projectName: z.string().nullable(),
  url: z.string(),
  labels: z.object({
    title: z.string(),
    closesIn: z.string(),
    submitted: z.string(),
    notSubmitted: z.string(),
  }),
  rank,
  updatedAt: isoString,
});

const judgingTeamSchema = { entryId: z.number().int(), name: z.string() };

const judgingLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("judging"),
  phase: z.enum(["presenting", "in_room", "called", "idle"]),
  roomId: z.number().int(),
  roomName: z.string(),
  roomLocation: z.string().nullable(),
  queueTitle: z.string().nullable(),
  roomPaused: z.boolean(),
  current: z
    .object({
      ...judgingTeamSchema,
      status: z.enum(["in_room", "presenting"]),
      enteredAt: isoString.nullable(),
      presentationStartedAt: isoString.nullable(),
      presentationPausedAt: isoString.nullable(),
      presentationPausedSeconds: z.number().int(),
      presentationSeconds: z.number().int().nullable(),
    })
    .nullable(),
  next: z.object({ ...judgingTeamSchema, calledAt: isoString.nullable() }).nullable(),
  calledCount: z.number().int(),
  waitingCount: z.number().int(),
  url: z.string(),
  labels: z.object({
    presenting: z.string(),
    inRoom: z.string(),
    next: z.string(),
    onTheWay: z.string(),
    waiting: z.string(),
    paused: z.string(),
    noTeam: z.string(),
    overtime: z.string(),
  }),
  rank,
  updatedAt: isoString,
});

const accreditationLivePropsSchema = z.object({
  v: z.literal(LIVE_ACTIVITY_PROPS_VERSION),
  kind: z.literal("accreditation"),
  phase: z.literal("live"),
  accredited: z.number().int(),
  eligible: z.number().int(),
  inside: z.number().int().nullable(),
  recentArrivals: z.number().int(),
  endsAt: isoString,
  scanUrl: z.string(),
  url: z.string(),
  labels: z.object({
    title: z.string(),
    accredited: z.string(),
    inside: z.string(),
    lastTenMinutes: z.string(),
    scan: z.string(),
  }),
  rank,
  updatedAt: isoString,
});

export const myLiveActivitiesResponseSchema = z.object({
  judgingWindowOpen: z.boolean(),
  queue: queueLivePropsSchema.nullable(),
  activities: z.array(activityLivePropsSchema),
  attendeeActivities: z.array(attendeeActivityLivePropsSchema),
  deadline: deadlineLivePropsSchema.nullable(),
  judging: z.array(judgingLivePropsSchema),
  accreditation: accreditationLivePropsSchema.nullable(),
  maxConcurrent: z.number().int(),
});

const configKindSchema = z.enum(LIVE_ACTIVITY_CONFIG_KINDS);

export const liveActivitySettingsSchema = z.object({
  maxConcurrent: z.number().int(),
  kinds: z.array(
    z.object({
      kind: configKindSchema,
      enabled: z.boolean(),
      priority: z.number().int(),
      roleIds: z.array(z.number().int()),
      requiredCapability: z.string().nullable(),
    }),
  ),
  roles: z.array(z.object({ id: z.number().int(), name: z.string() })),
});

/** Array order of `kinds` is the priority (index 0 = highest); every kind exactly once. */
export const putLiveActivitySettingsBodySchema = z
  .object({
    maxConcurrent: z
      .number()
      .int()
      .min(LIVE_ACTIVITY_MAX_CONCURRENT_MIN)
      .max(LIVE_ACTIVITY_MAX_CONCURRENT_MAX),
    kinds: z
      .array(
        z
          .object({
            kind: configKindSchema,
            enabled: z.boolean(),
            roleIds: z.array(z.number().int().positive()).max(500),
          })
          .strict(),
      )
      .length(LIVE_ACTIVITY_CONFIG_KINDS.length),
  })
  .strict()
  .refine((body) => new Set(body.kinds.map((k) => k.kind)).size === body.kinds.length, {
    message: "kinds must list every Live Activity kind exactly once",
    path: ["kinds"],
  });
