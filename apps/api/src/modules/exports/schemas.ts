import { z } from "zod";

export const requestTypeSchema = z.enum(["export", "deletion"]);
export const requestStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);

export const requestIdParam = z.object({ id: z.coerce.number().int().positive() });

export const createRequestBody = z
  .object({
    subjectUserId: z.coerce.number().int().positive(),
    type: requestTypeSchema,
    reason: z.string().max(2000).optional(),
  })
  .strict();

export const listRequestsQuery = z.object({
  status: requestStatusSchema.optional(),
  type: requestTypeSchema.optional(),
  subjectUserId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const requestResponseSchema = z.object({
  id: z.number(),
  subjectUserId: z.number().nullable(),
  requestedBy: z.number().nullable(),
  type: requestTypeSchema,
  status: requestStatusSchema,
  reason: z.string().nullable(),
  error: z.string().nullable(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  downloadAvailable: z.boolean(),
});

export const listRequestsResponseSchema = z.object({
  items: z.array(requestResponseSchema),
  total: z.number(),
});

export const applicationsCsvQuery = z.object({
  applicationId: z.coerce.number().int().positive().optional(),
});

export const applicationExportCatalogQuery = z.object({
  application_id: z.coerce.number().int().positive().optional(),
});

/** H56: every persisted response status that can be included in a batch export. */
export const APPLICATION_EXPORT_STATUSES = [
  "draft",
  "review",
  "accepted",
  "confirmed",
  "declined",
  "rejected",
  "expired",
  "accepted_internal",
  "rejected_internal",
] as const;

export const applicationExportFieldSchema = z
  .object({
    source: z.enum(["profile", "metadata", "answer"]),
    key: z.string().trim().min(1).max(160),
    application_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

export const applicationExportBody = z
  .object({
    statuses: z
      .array(z.enum(APPLICATION_EXPORT_STATUSES))
      .min(1)
      .max(APPLICATION_EXPORT_STATUSES.length),
    fields: z.array(applicationExportFieldSchema).min(1).max(200),
    application_ids: z.array(z.coerce.number().int().positive()).min(1).max(200).optional(),
    documents: z.enum(["none", "all", "shared"]).default("none"),
    language: z.enum(["es", "gl", "en"]).default("es"),
  })
  .strict();

export const activityExportModeSchema = z.enum(["people", "scans"]);

export const activitiesExportCatalogQuery = z.object({
  language: z.enum(["es", "gl", "en"]).default("es"),
});

export const activitiesExportBody = z
  .object({
    activity_ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
    mode: activityExportModeSchema.default("people"),
    language: z.enum(["es", "gl", "en"]).default("es"),
  })
  .strict();
