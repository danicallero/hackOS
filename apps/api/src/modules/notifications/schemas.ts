import { z } from "zod";

export const notificationChannelSchema = z.enum(["in_app", "email", "push", "discord"]);

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

export const announcementBodySchema = z
  .object({
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
  })
  .strict();

export const announcementUpdateBodySchema = announcementBodySchema.partial();

export const announcementIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const auditQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.coerce.number().int().optional(),
  action: z.string().optional(),
  dateFrom: z.iso.datetime({ offset: true }).optional(),
  dateTo: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
