import { z } from "zod";

export const notificationChannelSchema = z.enum(["in_app", "email", "push"]);

export const registerPushTokenBodySchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(["ios", "android"]).optional(),
});

export const preferenceItemSchema = z.object({
  category: z.string().min(1).max(100),
  channel: notificationChannelSchema,
  enabled: z.boolean(),
});

export const setPreferencesBodySchema = z.object({
  preferences: z.array(preferenceItemSchema).min(1),
});

export const inboxQuerySchema = z.object({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const notificationIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const announcementAudienceSchema = z.enum(["sponsor", "participant", "mentor"]);

const announcementBodyObjectSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  translations: z
    .object({
      es: z.object({ title: z.string().min(1).max(200), body: z.string().min(1) }).optional(),
      gl: z.object({ title: z.string().min(1).max(200), body: z.string().min(1) }).optional(),
      en: z.object({ title: z.string().min(1).max(200), body: z.string().min(1) }).optional(),
    })
    .optional()
    .default({}),
  notifyUsers: z.boolean().optional().default(false),
  screenPlacement: z.enum(["none", "embedded", "fullscreen"]).optional().default("none"),
  publishAt: z.iso.datetime({ offset: true }).nullable().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** Sponsor/participant/mentor tags (H59 vocabulary). Empty + no recipients = everyone. */
  audiences: z.array(announcementAudienceSchema).max(3).optional().default([]),
  /** Mutually exclusive with `audiences` — see the refine below. */
  recipientUserIds: z.array(z.number().int().positive()).optional().default([]),
  channels: z
    .array(notificationChannelSchema)
    .min(1)
    .optional()
    .default(["in_app", "email", "push"]),
});

/** Cross-field rules shared by create (full payload) and update (partial payload). */
const targetingExclusivityRefine = (v: {
  audiences?: string[];
  recipientUserIds?: number[];
}): boolean => !(v.audiences?.length && v.recipientUserIds?.length);
const notifyOnlyNoExpiryRefine = (v: {
  screenPlacement?: "none" | "embedded" | "fullscreen";
  notifyUsers?: boolean;
  expiresAt?: string | null;
}): boolean => !(v.screenPlacement === "none" && v.notifyUsers && v.expiresAt);
const screenNoSpecificRecipientsRefine = (v: {
  screenPlacement?: "none" | "embedded" | "fullscreen";
  recipientUserIds?: number[];
}): boolean => !(v.screenPlacement && v.screenPlacement !== "none" && v.recipientUserIds?.length);

export const announcementBodySchema = announcementBodyObjectSchema
  .strict()
  .refine(targetingExclusivityRefine, {
    message: "Choose either an audience or specific recipients, not both",
    path: ["recipientUserIds"],
  })
  .refine(notifyOnlyNoExpiryRefine, {
    message: "A notify-only announcement (no screen placement) can't have an end date",
    path: ["expiresAt"],
  })
  .refine(screenNoSpecificRecipientsRefine, {
    message: "A screen-placed announcement can't be targeted to specific recipients",
    path: ["recipientUserIds"],
  });

export const announcementUpdateBodySchema = announcementBodyObjectSchema
  .partial()
  .strict()
  .refine(targetingExclusivityRefine, {
    message: "Choose either an audience or specific recipients, not both",
    path: ["recipientUserIds"],
  })
  .refine(notifyOnlyNoExpiryRefine, {
    message: "A notify-only announcement (no screen placement) can't have an end date",
    path: ["expiresAt"],
  })
  .refine(screenNoSpecificRecipientsRefine, {
    message: "A screen-placed announcement can't be targeted to specific recipients",
    path: ["recipientUserIds"],
  });

export const announcementIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const announcementRecipientCandidatesQuerySchema = z.object({
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const auditQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.coerce.number().int().optional(),
  actorQuery: z.string().optional(),
  action: z.string().optional(),
  dateFrom: z.iso.datetime({ offset: true }).optional(),
  dateTo: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
