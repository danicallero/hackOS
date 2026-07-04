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
});

export const grantEntitlementBody = z.object({
  userId: z.coerce.number().int().positive(),
});
