import { z } from "zod";

/** Body shared by preview and confirm — raw CSV text of both Devpost exports. */
export const importCsvBodySchema = z.object({
  projectsCsv: z.string().min(1, "projectsCsv is required"),
  participantsCsv: z.string().min(1, "participantsCsv is required"),
});
export type ImportCsvBody = z.infer<typeof importCsvBodySchema>;

export const linkParticipantBodySchema = z.object({
  repoId: z.number().int().positive(),
  email: z.string().email(),
  userId: z.number().int().positive(),
});
export type LinkParticipantBody = z.infer<typeof linkParticipantBodySchema>;

export const claimEmailBodySchema = z.object({
  repoId: z.number().int().positive(),
  email: z.string().email(),
});
export type ClaimEmailBody = z.infer<typeof claimEmailBodySchema>;

export const mapPrizeBodySchema = z.object({
  challengeId: z.number().int().positive(),
});
export type MapPrizeBody = z.infer<typeof mapPrizeBodySchema>;

export const prizeParamsSchema = z.object({
  prizeName: z.string().min(1),
});

export const repoIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const repoMemberParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

export const repoDevpostParticipantParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  email: z.email(),
});

export const repoChallengeParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  challengeId: z.coerce.number().int().positive(),
});

/** POST /api/challenges/:challengeId/repos:bulk-add|bulk-remove (H21 bulk enrollment). */
export const challengeIdOnlyParamsSchema = z.object({
  challengeId: z.coerce.number().int().positive(),
});

export const repoPrizeParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  prizeName: z.string().min(1),
});

const repoUrl = z.string().url().max(2000);

/** POST /api/repos (H18) — native creation with team + challenge lineup. */
export const createRepoBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(""),
  githubUrl: repoUrl.nullable().default(null),
  demoUrl: repoUrl.nullable().default(null),
  memberUserIds: z.array(z.number().int().positive()).max(50).default([]),
  challengeIds: z.array(z.number().int().positive()).max(50).default([]),
});
export type CreateRepoBody = z.infer<typeof createRepoBodySchema>;

/** PATCH /api/repos/:id (H18) — metadata only; team/challenges have their own H21 routes. */
export const updateRepoBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10000).optional(),
    githubUrl: repoUrl.nullable().optional(),
    demoUrl: repoUrl.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one field is required",
  });
export type UpdateRepoBody = z.infer<typeof updateRepoBodySchema>;

/** POST /api/me/projects (H19) — no memberUserIds: the creator is the sole initial member. */
export const createMyProjectBodySchema = createRepoBodySchema.omit({ memberUserIds: true });
export type CreateMyProjectBody = z.infer<typeof createMyProjectBodySchema>;

export const repoMemberBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const repoChallengeBodySchema = z.object({
  challengeId: z.coerce.number().int().positive(),
});
