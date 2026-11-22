import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  getRequestAuthorizationContext,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { keyByIp, rateLimitGuard } from "../../lib/rate-limit.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  cancelDuplicateCase,
  decideDuplicateMerge,
  dismissDuplicate,
  getDuplicateOverview,
  lookupDuplicateMerge,
  proposeDuplicateMerge,
} from "./duplicates.js";
import { idParamSchema } from "./schemas.js";

const responsePairSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]);

const tokenSchema = z.object({ token: z.string().min(1).max(200) });

/**
 * Duplicate applications (H13 review, H54 removal of the merged account).
 * Reviewers read and dismiss pairs; proposing or withdrawing a merge edits
 * answers, so it needs APPLICATIONS_EDIT_RESPONSE. The applicant answers
 * through the emailed link (token routes, like the H15 confirmation link).
 */
export function registerDuplicateRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const review = CAPABILITIES.APPLICATIONS_REVIEW;
  const edit = CAPABILITIES.APPLICATIONS_EDIT_RESPONSE;

  r.get(
    "/api/applications/:id/duplicates",
    {
      preHandler: requireCapability(review),
      config: routeAccess({ kind: "capability", capability: review }),
      schema: {
        summary: "List possible duplicate applications",
        description:
          "Pairs of responses to this form that look like one person applying from two accounts (H13): the same DNI (from the answer or the account), or names or email local parts at least 85% similar. Pairs with an open case (dismissed, pending merge, kept separate by the applicant) are not suggested again. Also lists every case of the form; a pending case is outdated when either response changed after the proposal.",
        params: idParamSchema,
      },
    },
    async (req) => getDuplicateOverview(req.params.id),
  );

  r.post(
    "/api/applications/:id/duplicates/dismiss",
    {
      preHandler: [requireCapability(review), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: review }),
      schema: {
        summary: "Mark two applications as different people",
        description:
          "Records that a suggested pair are different people so it stops being suggested (H13). Audited. 409 duplicate_case_exists when the pair already has an open case.",
        params: idParamSchema,
        body: z.object({ response_ids: responsePairSchema }),
      },
    },
    async (req) => dismissDuplicate(req.userId as number, req.params.id, req.body.response_ids),
  );

  r.post(
    "/api/applications/:id/duplicates/merges",
    {
      preHandler: [requireCapability(edit), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: edit }),
      schema: {
        summary: "Propose merging two applications",
        description:
          "Stores the merged answers (each question from the response chosen in field_sources, otherwise from the one that answered it) and the response whose submission date and status are kept, then emails both owners a link valid for 14 days (H13). Nothing changes until an owner answers: they pick the account to keep, whose response receives the merged answers while the other account is deleted (H54), or keep both separate. Only draft or in-review responses can be merged (409 duplicate_merge_decided); when either was submitted, the kept submission date must be a submitted one (409 duplicate_merge_submission_required). Audited with field names only.",
        params: idParamSchema,
        body: z.object({
          response_ids: responsePairSchema,
          field_sources: z.record(z.string(), z.number().int().positive()).default({}),
          submitted_from_response_id: z.number().int().positive(),
        }),
      },
    },
    async (req) => proposeDuplicateMerge(req.userId as number, req.params.id, req.body),
  );

  r.post(
    "/api/applications/:id/duplicates/:caseId/cancel",
    {
      preHandler: [requireCapability(review), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: review }),
      schema: {
        summary: "Withdraw a merge proposal or undo a dismissal",
        description:
          "A dismissed pair becomes a suggestion again; a pending merge proposal is withdrawn and its links stop working, which also needs APPLICATIONS_EDIT_RESPONSE (H13). 409 duplicate_case_closed for an answered case. Audited.",
        params: idParamSchema.extend({ caseId: z.coerce.number().int().positive() }),
      },
    },
    async (req) => {
      const canEdit = await userHasCapability(getRequestAuthorizationContext(req), edit);
      await cancelDuplicateCase(req.userId as number, req.params.id, req.params.caseId, canEdit);
      return { status: true };
    },
  );

  r.post(
    "/api/applications/duplicate-merges/lookup",
    {
      preHandler: rateLimitGuard("duplicate-merge-link", { windowSeconds: 60, max: 30 }, keyByIp),
      config: routeAccess({ kind: "token", policy: "application-duplicate-merge" }),
      schema: {
        summary: "Show a proposed merge from its email link",
        description:
          "Public, read-only view for the link emailed with a merge proposal (H13): the merged answers (file answers by file name), the kept submission date and both accounts — the link holder's own address in full, the other one masked. 404 duplicate_merge_invalid for an unknown link; 409 duplicate_merge_closed (with the final status), duplicate_merge_expired or duplicate_merge_outdated when it can no longer be answered. Rate limited to 30/min per IP. POST so the token never appears in a URL.",
        body: tokenSchema,
      },
    },
    async (req) => lookupDuplicateMerge(req.body.token),
  );

  r.post(
    "/api/applications/duplicate-merges/decide",
    {
      preHandler: [
        rateLimitGuard("duplicate-merge-link", { windowSeconds: 60, max: 30 }, keyByIp),
        idempotencyGuard,
      ],
      config: routeAccess({ kind: "token", policy: "application-duplicate-merge" }),
      schema: {
        summary: "Answer a proposed merge",
        description:
          "The link holder merges the two applications into the account they keep, or keeps both separate (H13). Exactly one answer wins. A merge copies any file chosen from the other account, writes the merged answers, submission date and status to the kept response, deletes the other response and then deletes the other account through the H54 removal flow; it is refused with 409 duplicate_merge_needs_staff when that account has event history and 409 duplicate_merge_outdated when either response changed after the proposal. Same-key retries replay the first result. Audited.",
        body: tokenSchema.extend({
          decision: z.enum(["merge", "keep_separate"]),
          keep: z.enum(["first", "second"]).optional(),
        }),
      },
    },
    async (req) => {
      const { token, decision, keep } = req.body;
      if (decision === "merge") {
        if (!keep) throw new BadRequestError("Choose the account to keep");
        return decideDuplicateMerge(token, { decision, keep });
      }
      return decideDuplicateMerge(token, { decision });
    },
  );
}
