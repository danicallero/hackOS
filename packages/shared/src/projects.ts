import { z } from "zod";
import {
  fieldsReferenceKnownSections,
  libraryDeletionsSchema,
  sectionsSchema,
  templateSchema,
} from "./forms.js";

/** Native project lifecycle and configuration (#1006–#1009). */
export const PROJECT_STATUSES = ["draft", "submitted"] as const;
export const PROJECT_MEMBER_STATUSES = ["invited", "active", "declined"] as const;
export const PROJECT_TIMING_PREFERENCES = ["no_preference", "early", "middle", "late"] as const;
export const projectSettingsSchema = z
  .object({
    draftsOpenAt: z.iso.datetime({ offset: true }).nullable(),
    submissionsCloseAt: z.iso.datetime({ offset: true }).nullable(),
    draftVisibility: z.enum(["team_only", "attendees", "public"]),
    galleryOpensAt: z.iso.datetime({ offset: true }).nullable(),
    galleryAudience: z.enum(["staff", "attendees", "public"]),
    editsLockAt: z.iso.datetime({ offset: true }).nullable(),
    maxTeamSize: z.number().int().positive().max(100).nullable(),
  })
  .strict();
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export const projectFormSchema = z
  .object({
    template: templateSchema,
    library_deletions: libraryDeletionsSchema.optional(),
    sections: sectionsSchema.default([]),
  })
  .strict()
  .refine((form) => fieldsReferenceKnownSections(form.template, form.sections), {
    message: "Field sections must reference a defined section",
  });
export type ProjectForm = z.infer<typeof projectFormSchema>;
export const projectDraftSchema = z
  .object({
    responses: z.record(z.string(), z.unknown()),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const projectGalleryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  challengeId: z.coerce.number().int().positive().optional(),
  winnersOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().trim().max(200).optional(),
});
