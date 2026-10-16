import { z } from "zod";

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

/** POST /api/challenges/:challengeId/repos:bulk-add|bulk-remove (H21 bulk enrollment). */
export const challengeIdOnlyParamsSchema = z.object({
  challengeId: z.coerce.number().int().positive(),
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
    presentationTimingPreference: z.enum(["no_preference", "early", "middle", "late"]).optional(),
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

/**
 * POST /api/me/projects/:id/invites (H19/H20) — invite a teammate by email, or
 * by user id when that person is one of the caller's event-diary contacts.
 */
export const inviteProjectMemberBodySchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.coerce.number().int().positive().optional(),
  })
  .refine((body) => (body.email === undefined) !== (body.userId === undefined), {
    message: "Provide exactly one of email or userId",
  });
export type InviteProjectMemberBody = z.infer<typeof inviteProjectMemberBodySchema>;

export const repoChallengeBodySchema = z.object({
  challengeId: z.coerce.number().int().positive(),
});
