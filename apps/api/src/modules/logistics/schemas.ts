import { z } from "zod";

export const activityIdParam = z.object({ id: z.coerce.number().int().positive() });
export const entitlementUserParam = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});
export const userIdParam = z.object({ userId: z.coerce.number().int().positive() });

export const lookupBody = z.object({ ticketToken: z.string().min(1) });
export const lookupUserBody = z.object({ userId: z.coerce.number().int().positive() });

export const checkInBody = z.object({
  ticketToken: z.string().min(1),
  badgeId: z.string().min(1),
  method: z.enum(["qr", "manual", "nfc"]).default("qr"),
});

export const checkInUserBody = z.object({
  userId: z.coerce.number().int().positive(),
  badgeId: z.string().min(1),
  method: z.enum(["qr", "manual", "nfc"]).default("manual"),
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
});

export const scannableActivitiesQuery = z.object({
  category: z.enum(["meal", "activity"]).optional(),
});

export const activityScanBody = z.object({
  badgeId: z.string().min(1),
  allowRepeat: z.boolean().default(false),
  scannedAt: z.coerce.date().optional(),
});

export const grantEntitlementBody = z.object({
  userId: z.coerce.number().int().positive(),
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
