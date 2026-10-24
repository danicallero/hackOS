import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { sendCsv } from "../../lib/csv.js";
import { ForbiddenError, TooManyRequestsError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { consumeRateLimit } from "../../lib/rate-limit.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";
import { presenceTimeline } from "../logistics/presence.js";
import { assertFixtureSubjectScope } from "../logistics/review-fixture-scope.js";
import {
  approveCertificateHours,
  availableCertificateTypes,
  certificateIdByCode,
  certificateOwner,
  certificateParticipants,
  eligibilityFor,
  exportCertificateParticipants,
  issueForSelf,
  issueForStaff,
  issueInBulk,
  listForUser,
  readSettings,
  renderCertificate,
  revokeCertificate,
  updateSettings,
  verifyCode,
} from "./service.js";
import { registerCertificateTypeRoutes } from "./type-routes.js";

const variant = z.enum(["participation", "hours", "activities"]);
const locale = z.enum(["es", "gl", "en"]);
const idParams = z.object({ id: z.coerce.number().int().positive() });

const settingsSchema = z.object({
  minHours: z.number().nullable(),
  minReviewHours: z.number().nullable(),
  awardHours: z.number().nullable(),
  requiresDemo: z.boolean(),
  issuerName: z.string(),
});
const eligibilitySchema = z.object({
  hours: z.number(),
  certifiedHours: z.number().nullable(),
  reviewRequired: z.boolean(),
  approval: z
    .object({
      certifiedHours: z.number(),
      reason: z.string(),
      approvedBy: z.number().nullable(),
      approvedAt: z.string(),
    })
    .nullable(),
  demoed: z.boolean(),
  eligible: z.boolean(),
  reason: z.enum(["not_available", "hours_not_met", "demo_required", "review_required"]).nullable(),
});
const certificateSchema = z.object({
  id: z.number(),
  code: z.string(),
  userId: z.number().nullable(),
  typeId: z.number(),
  typeName: z.string().nullable(),
  recipientName: z.string(),
  activityName: z.string(),
  variant,
  locale,
  source: z.enum(["self", "bulk", "staff"]),
  overrideReason: z.string().nullable(),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
});

/**
 * #1083: the public routes answer by code. Codes are 24 random characters, so guessing is
 * hopeless; the limit per client address still stops anyone from iterating at speed.
 */
async function limitVerification(req: FastifyRequest): Promise<void> {
  const result = await consumeRateLimit("certificate-verify", req.ip, {
    windowSeconds: 60,
    max: 60,
  });
  if (!result.allowed) {
    throw new TooManyRequestsError("Too many requests, try again later.", result.retryAfterSeconds);
  }
}

/** #1083: attendance certificates. Staff routes need `presence:manage`, the capability behind verified hours. */
export function registerCertificateRoutes(app: FastifyInstance): void {
  registerCertificateTypeRoutes(app);
  const r = app.withTypeProvider<ZodTypeProvider>();
  const staff = requireCapability(CAPABILITIES.PRESENCE_MANAGE);
  const staffPolicy = { kind: "capability" as const, capability: CAPABILITIES.PRESENCE_MANAGE };
  const own = { routeAccessPolicy: { kind: "authenticated" as const } };

  const sendPdf = async (
    reply: { header(name: string, value: string): unknown },
    id: number,
    copy: boolean,
    disposition: "attachment" | "inline" = "attachment",
  ): Promise<Buffer> => {
    const { pdf, filename } = await renderCertificate(id, { copy });
    reply.header("content-type", "application/pdf");
    reply.header("content-disposition", `${disposition}; filename="${filename}"`);
    reply.header("cache-control", "private, no-store");
    return Buffer.from(pdf);
  };

  r.get(
    "/api/certificates/participants",
    {
      ...routeAccess(staffPolicy),
      preHandler: staff,
      schema: {
        summary: "Attendance certificate review roster",
        description:
          "Event attendees with university, secured attendance, automatic eligibility, review candidacy and the awarded hours. Raw scans are preserved (#1083).",
        querystring: z.object({ universityId: z.coerce.number().int().positive().optional() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                userId: z.number(),
                name: z.string(),
                surname: z.string().nullable(),
                universityId: z.number().nullable(),
                universityName: z.string().nullable(),
                eligibility: eligibilitySchema,
              }),
            ),
          }),
        },
      },
    },
    async (req) => ({
      items: await certificateParticipants(req.userId as number, req.query.universityId),
    }),
  );

  r.get(
    "/api/certificates/participants/export.csv",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.LOGISTICS_STATS }),
      preHandler: requireCapability(CAPABILITIES.LOGISTICS_STATS),
      schema: {
        summary: "Export participant attendance and certified hours",
        description:
          "CSV of attendees with secured time or a manual award, optionally filtered by university. General format separates measured and certified hours. UDC format matches Modelo Rexistro Actividades and includes only automatic/approved awards; its hours are exactly those used on certificates. Audited and never cached (#1083, H54).",
        querystring: z.object({
          universityId: z.coerce.number().int().positive().optional(),
          format: z.enum(["general", "udc"]).default("general"),
        }),
      },
    },
    async (req, reply) =>
      sendCsv(
        reply,
        `certificate-attendance-${req.query.format}.csv`,
        await exportCertificateParticipants(req.userId as number, req.query),
      ),
  );

  r.post(
    "/api/users/:id/certificate-approval",
    {
      ...routeAccess(staffPolicy),
      preHandler: [staff, idempotencyGuard],
      schema: {
        params: idParams,
        body: z.object({
          certifiedHours: z.number().positive().max(999),
          reason: z.string().trim().min(1).max(2000),
        }),
        summary: "Approve a participant's certified hours",
        description:
          "Records a case-by-case attendance award with explicit hours and reason, without changing presence scans. The award unlocks self-service certificates and feeds university CSVs. Existing documents with different hours are revoked so their public codes cannot verify an obsolete award. Audited and serialized with issuance and account removal (#1083, H53, H54).",
        response: { 200: eligibilitySchema },
      },
    },
    async (req) =>
      approveCertificateHours(
        req.userId as number,
        req.params.id,
        req.body.certifiedHours,
        req.body.reason,
      ),
  );

  r.get(
    "/api/users/:id/certificate-evidence",
    {
      ...routeAccess(staffPolicy),
      preHandler: staff,
      schema: {
        params: idParams,
        summary: "Review attendance evidence for certificates",
        description:
          "All door and activity signals, including meals, in the existing presence timeline. Staff assess activity context before recording certified hours. Does not change the measured attendance (#1083).",
      },
    },
    async (req) => {
      await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
      return presenceTimeline(req.params.id, undefined, req.userId as number);
    },
  );

  r.get(
    "/api/me/certificates",
    {
      config: own,
      preHandler: requireAuth,
      schema: {
        summary: "My certificate eligibility and certificates",
        description:
          "The caller's secured venue hours, whether their team presented a project, whether they meet the certificate policy (and why not) and the certificates already issued to them (#1083).",
        response: {
          200: z.object({
            settings: settingsSchema,
            eligibility: eligibilitySchema,
            certificates: z.array(certificateSchema),
            types: z.array(z.unknown()),
          }),
        },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const [settings, eligibility, certificates] = await Promise.all([
        readSettings(),
        eligibilityFor(userId),
        listForUser(userId),
      ]);
      return {
        settings,
        eligibility,
        certificates,
        types: await availableCertificateTypes(userId, true),
      };
    },
  );

  r.post(
    "/api/me/certificates",
    {
      config: own,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: z.object({ variant, locale }),
        summary: "Issue my certificate",
        description:
          "Issues the caller's certificate in the chosen variant (participation, hours or activities) and language, or returns the one already issued in that language. 409 with a reason when certificates are off, the venue-hours threshold is not met or the policy requires a presented project (#1083, H53).",
        response: { 200: certificateSchema },
      },
    },
    async (req) => issueForSelf(req.userId as number, req.body.variant, req.body.locale),
  );

  r.get(
    "/api/me/certificates/:id/pdf",
    {
      config: own,
      preHandler: requireAuth,
      schema: {
        params: idParams,
        summary: "Download my certificate",
        description:
          "The certificate as a PDF issued by the organisation, with a footer carrying a verification QR, the CSV code and the print date on every page. Only its owner can download it; a revoked certificate answers 409 (#1083).",
      },
    },
    async (req, reply) => {
      if ((await certificateOwner(req.params.id)) !== req.userId) {
        throw new ForbiddenError("Not your certificate");
      }
      return sendPdf(reply, req.params.id, true);
    },
  );

  r.get(
    "/api/certificates/settings",
    {
      ...routeAccess(staffPolicy),
      preHandler: staff,
      schema: {
        summary: "Certificate policy",
        description:
          "Automatic and review hours thresholds (null disables each path), whether a presented project is required, and the issuer name printed on certificates (#1083).",
        response: { 200: settingsSchema },
      },
    },
    async () => readSettings(),
  );

  r.put(
    "/api/certificates/settings",
    {
      ...routeAccess(staffPolicy),
      preHandler: [staff, idempotencyGuard],
      schema: {
        body: z
          .object({
            minHours: z.number().min(0).max(999).nullable().optional(),
            minReviewHours: z.number().min(0).max(999).nullable().optional(),
            awardHours: z.number().positive().max(999).nullable().optional(),
            requiresDemo: z.boolean().optional(),
            issuerName: z.string().trim().min(1).max(200).optional(),
          })
          .strict(),
        summary: "Update the certificate policy",
        description:
          "Changes the optional certified-hours award, automatic/review hours thresholds, the presented-project requirement or the issuer name. Already issued certificates keep what they were issued with. Audited as `certificate_settings.update` (#1083, H53).",
        response: { 200: settingsSchema },
      },
    },
    async (req) => updateSettings(req.userId as number, req.body),
  );

  r.get(
    "/api/users/:id/certificates",
    {
      ...routeAccess(staffPolicy),
      preHandler: staff,
      schema: {
        params: idParams,
        summary: "A person's certificates and eligibility",
        description:
          "Staff view of one person: their hours, whether they meet the policy and every certificate issued to them, revoked ones included (#1083).",
        response: {
          200: z.object({
            settings: settingsSchema,
            eligibility: eligibilitySchema,
            certificates: z.array(certificateSchema),
            types: z.array(z.unknown()),
          }),
        },
      },
    },
    async (req) => ({
      settings: await readSettings(),
      eligibility: await eligibilityFor(req.params.id),
      certificates: await listForUser(req.params.id),
      types: await availableCertificateTypes(req.params.id, false),
    }),
  );

  r.post(
    "/api/certificates",
    {
      ...routeAccess(staffPolicy),
      preHandler: [staff, idempotencyGuard],
      schema: {
        body: z.object({
          userId: z.number().int().positive(),
          variant,
          locale,
          overrideReason: z.string().trim().min(1).max(500).nullish(),
          certifiedHours: z.number().positive().max(999).optional(),
        }),
        summary: "Issue a certificate to a person",
        description:
          "Issues a certificate to one person. Below the policy it needs explicit `certifiedHours` and `overrideReason`, recorded on the certificate and in the audit log; without it the request answers 409 with the unmet rule. Returns the existing certificate when one is already live in that language (#1083, H53).",
        response: { 200: certificateSchema },
      },
    },
    async (req) => issueForStaff(req.userId as number, req.body),
  );

  r.post(
    "/api/certificates/bulk",
    {
      ...routeAccess(staffPolicy),
      preHandler: [staff, idempotencyGuard],
      schema: {
        body: z.object({ variant, locale }),
        summary: "Issue certificates to everyone eligible",
        description:
          "Issues the variant to every attendee who meets the policy. People who already hold a live certificate of that variant and language are counted as `existing`, everyone else as `skipped`. Manual awards remain eligible when automatic issue is off (#1083, H53).",
        response: {
          200: z.object({ issued: z.number(), existing: z.number(), skipped: z.number() }),
        },
      },
    },
    async (req) => issueInBulk(req.userId as number, req.body.variant, req.body.locale),
  );

  r.post(
    "/api/certificates/:id/revoke",
    {
      ...routeAccess(staffPolicy),
      preHandler: [staff, idempotencyGuard],
      schema: {
        params: idParams,
        body: z.object({ reason: z.string().trim().min(1).max(500) }),
        summary: "Revoke a certificate",
        description:
          "Revokes a live certificate with a reason. The public verification page then reports it as revoked and the PDF can no longer be downloaded. Audited as `certificate.revoke` (#1083, H53).",
        response: { 200: certificateSchema },
      },
    },
    async (req) => revokeCertificate(req.userId as number, req.params.id, req.body.reason),
  );

  r.get(
    "/api/certificates/:id/pdf",
    {
      ...routeAccess(staffPolicy),
      preHandler: staff,
      schema: {
        params: idParams,
        querystring: z.object({ copy: z.coerce.boolean().default(false) }),
        summary: "Download anyone's certificate",
        description:
          "Staff download of a person's certificate PDF. By default it has no CSV footer; `copy=true` returns what the participant gets, with the footer. A revoked certificate answers 409 (#1083).",
      },
    },
    async (req, reply) => sendPdf(reply, req.params.id, req.query.copy),
  );

  r.get(
    "/api/public/certificates/:code",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } },
      preHandler: limitVerification,
      schema: {
        params: z.object({ code: z.string().min(16).max(64) }),
        summary: "Verify a certificate",
        description:
          "Public check of a certificate by the code printed on it: whether it is valid or revoked, who it was issued to, the event and its dates, and the hours only for the hours variant. Never returns a DNI/NIE; a revoked certificate shows no personal data. 404 for an unknown code, 429 past 60 requests a minute from one address (#1083).",
        response: {
          200: z.object({
            status: z.enum(["valid", "revoked"]),
            variant,
            issuedAt: z.string(),
            issuerName: z.string().nullable(),
            name: z.string().nullable(),
            surname: z.string().nullable(),
            eventName: z.string().nullable(),
            eventStartsAt: z.string().nullable(),
            eventEndsAt: z.string().nullable(),
            hours: z.number().nullable(),
          }),
        },
      },
    },
    async (req) => verifyCode(req.params.code),
  );

  r.get(
    "/api/public/certificates/:code/pdf",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } },
      preHandler: limitVerification,
      schema: {
        params: z.object({ code: z.string().min(16).max(64) }),
        summary: "View the official certificate",
        description:
          "The certificate PDF itself, with the CSV footer, for anyone holding its verification code (the code is printed on every copy). 404 for an unknown code, 409 once revoked and 429 past 60 requests a minute from one address (#1083).",
      },
    },
    async (req, reply) =>
      sendPdf(reply, await certificateIdByCode(req.params.code), true, "inline"),
  );
}
