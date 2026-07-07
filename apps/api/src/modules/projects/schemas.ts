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

export const repoChallengeParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  challengeId: z.coerce.number().int().positive(),
});

export const repoPrizeParamsSchema = z.object({
  repoId: z.coerce.number().int().positive(),
  prizeName: z.string().min(1),
});

export const repoMemberBodySchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const repoChallengeBodySchema = z.object({
  challengeId: z.coerce.number().int().positive(),
});
