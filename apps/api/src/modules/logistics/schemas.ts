import { z } from "zod";
import { PERSON_FIELDS } from "./people.js";

export const activityIdParam = z.object({ id: z.coerce.number().int().positive() });
export const userIdParam = z.object({ userId: z.coerce.number().int().positive() });

export const lookupBody = z.object({ ticketToken: z.string().min(1) });
export const lookupUserBody = z.object({ userId: z.coerce.number().int().positive() });

export const personSearchBody = z.object({
  q: z.string().min(1).max(200),
  fields: z.array(z.enum(PERSON_FIELDS)).min(1).optional(),
});

export const checkInBody = z.object({
  ticketToken: z.string().min(1),
  badgeId: z.string().min(1),
  method: z.enum(["qr", "manual", "nfc"]).default("qr"),
});

export const checkInUserBody = z.object({
  userId: z.coerce.number().int().positive(),
  badgeId: z.string().min(1),
  method: z.enum(["qr", "manual", "nfc"]).default("manual"),
  attendeeRole: z.enum(["participant", "mentor"]).optional(),
});

export const rotateBody = z
  .object({
    userId: z.coerce.number().int().positive().optional(),
    currentBadgeId: z.string().min(1).optional(),
    newBadgeId: z.string().min(1),
    reason: z.string().min(1),
  })
  .refine((b) => b.userId != null || b.currentBadgeId != null, {
    message: "Provide userId or currentBadgeId",
  });

export const removeBadgeBody = z.object({
  userId: z.coerce.number().int().positive(),
  reason: z.string().min(1),
});

export const presenceLookupBody = z.object({ badgeId: z.string().min(1) });

export const presenceScanBody = z.object({
  badgeId: z.string().min(1),
  kind: z.enum(["in", "out"]),
  scannedAt: z.coerce.date().optional(),
});

export const timeLogIdParam = z.object({ id: z.coerce.number().int().positive() });

export const timeLogPatchBody = z.object({
  kind: z.enum(["in", "out"]).optional(),
  scannedAt: z.coerce.date().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const presenceSignalBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["in", "out"]),
    occurredAt: z.coerce.date(),
    notes: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    kind: z.literal("activity"),
    activityId: z.number().int().positive(),
    occurredAt: z.coerce.date(),
    notes: z.string().max(1000).nullable().optional(),
  }),
]);

export const presenceActivityPatchBody = z.object({
  activityId: z.number().int().positive().optional(),
  occurredAt: z.coerce.date().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const scannableActivitiesQuery = z.object({
  category: z.enum(["meal", "activity"]).optional(),
});

export const scanLogQuery = z.object({
  staffId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const staffScanCountsSchema = z.object({
  accreditationCount: z.number().int(),
  presenceCount: z.number().int(),
  activityCount: z.number().int(),
});

export const scanLogResponse = z.object({
  items: z.array(
    z.object({
      id: z.number().int(),
      source: z.enum(["accreditation", "door", "activity"]),
      occurredAt: z.string(),
      detail: z.string().nullable(),
      subjectUserId: z.number().int(),
      subjectName: z.string(),
      subjectSurname: z.string(),
    }),
  ),
  total: z.number().int(),
});

export const staffScanStatsResponse = staffScanCountsSchema;

export const staffScanRankingResponse = z.object({
  items: z.array(
    staffScanCountsSchema.extend({
      staffId: z.number().int(),
      name: z.string(),
      surname: z.string(),
      total: z.number().int(),
    }),
  ),
});

const scannerPersonCard = z.object({
  userId: z.number().int().positive(),
  email: z.string().email(),
  role: z.enum(["admin", "judge", "sponsor", "staff", "mentor", "participant", "unassigned"]),
  ticketToken: z.string().nullable(),
  badgeId: z.string().nullable(),
  revokedBadgeIds: z.array(z.string()),
  name: z.string().nullable(),
  surname: z.string().nullable(),
  accepted: z.boolean(),
  confirmed: z.boolean(),
  intolerances: z.array(
    z.object({ id: z.number().int().positive(), label: z.record(z.string(), z.string()) }),
  ),
  foodIntoleranceNotes: z.string().nullable(),
  notes: z.string().nullable(),
  lastPresenceKind: z.enum(["in", "out"]).nullable(),
  lastPresenceAt: z.string().datetime().nullable(),
});

export const scannerSnapshotResponse = z.object({
  generatedAt: z.string().datetime(),
  people: z.array(scannerPersonCard),
  activities: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      category: z.string(),
      requiresScan: z.boolean(),
      startsAt: z.string().datetime().nullable(),
    }),
  ),
  activityStates: z.array(
    z.object({
      userId: z.number().int().positive(),
      activityId: z.number().int().positive(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export const activityScanBody = z.object({
  badgeId: z.string().min(1),
  allowRepeat: z.boolean().default(false),
  scannedAt: z.coerce.date().optional(),
});

export const mealScanBatchBody = z.object({
  deviceId: z.string().min(1),
  scans: z
    .array(
      z.object({
        clientScanId: z.string().min(1),
        badgeId: z.string().min(1),
        allowRepeat: z.boolean().default(false),
        scannedAt: z.coerce.date().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const walletPurposeParam = z.object({ purpose: z.enum(["ticket", "badge"]) });

/** Scoped wallet credential from the confirmation email (issue #369). */
export const walletAccessQuery = z.object({ token: z.string().min(1) });

export const applePassParams = z.object({
  passTypeIdentifier: z.string().min(1),
  serialNumber: z.string().min(1),
});

export const appleDeviceParams = applePassParams.extend({
  deviceLibraryIdentifier: z.string().min(1),
});

export const appleRegistrationsQuery = z.object({
  passesUpdatedSince: z.string().optional(),
});

export const appleRegistrationBody = z.object({
  pushToken: z.string().min(1),
});

export const appleLogBody = z.object({
  logs: z.array(z.string()).default([]),
});

export const scheduleIdParam = z.object({ id: z.coerce.number().int().positive() });

export const scheduleBody = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  type: z.string().max(80).nullable().optional(),
  requiresScan: z.boolean().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  visibility: z.enum(["shown", "hidden"]).default("hidden"),
  publishAt: z.coerce.date().nullable().optional(),
});

export const schedulePatchBody = scheduleBody.partial();

export const scheduleVisibilityBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  visibility: z.enum(["shown", "hidden"]),
});
