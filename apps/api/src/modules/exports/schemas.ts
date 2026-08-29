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
