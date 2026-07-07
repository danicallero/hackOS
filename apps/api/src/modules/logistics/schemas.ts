import { z } from "zod";

export const activityIdParam = z.object({ id: z.coerce.number().int().positive() });
export const entitlementUserParam = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});
export const userIdParam = z.object({ userId: z.coerce.number().int().positive() });

export const lookupBody = z.object({ ticketToken: z.string().min(1) });

export const checkInBody = z.object({
  ticketToken: z.string().min(1),
  badgeId: z.string().min(1),
  method: z.enum(["qr", "manual", "nfc"]).default("qr"),
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

export const presenceScanBody = z.object({
  badgeId: z.string().min(1),
  kind: z.enum(["in", "out"]),
  location: z.string().optional(),
  scannedAt: z.coerce.date().optional(),
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
