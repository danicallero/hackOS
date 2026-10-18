import { createHash } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ZipArchive } from "archiver";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAnyCapability, requireAuth, requireCapability } from "../../lib/capabilities.js";
import { sendCsv, toCsv } from "../../lib/csv.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { sharedCache } from "../../lib/shared-cache.js";
import { putObject } from "../../lib/storage.js";
import {
  enterpriseAccessFor,
  requireEnterpriseAccess,
  requireEnterpriseJudgeManager,
  requireSponsorPortalAccess,
} from "./access.js";
import {
  addJudgeBody,
  addMemberBody,
  bulkVisibilityBody,
  CONTENT_TYPE_EXT,
  createEnterpriseBody,
  enterpriseIdParam,
  judgeParams,
  memberParams,
  OWNER_EDITABLE_KEYS,
  publicSponsorsQuery,
  reorderEnterprisesBody,
  sponsorFaqBody,
  standScannableBody,
  standTagBody,
  standTagLabelBody,
  standTagParams,
  updateEnterpriseBody,
} from "./schemas.js";
import {
  addEnterpriseJudge,
  addEnterpriseMember,
  createEnterprise,
  getEnterprise,
  getSponsorFaq,
  listEnterpriseJudges,
  listEnterpriseMembers,
  listEnterprises,
  listJudgeCandidates,
  listPublicSponsors,
  listUserEnterprises,
  myEnterprise,
  removeEnterpriseJudge,
  removeEnterpriseMember,
  reorderEnterprises,
  setEnterpriseLogo,
  setEnterprisesVisibility,
  updateEnterprise,
  updateSponsorFaq,
} from "./service.js";
import { companyTagUrl, standQrFilename, standQrSvg } from "./stand-qr.js";
import {
  addStandTag,
  exportStandCodes,
  generateMissingQrTags,
  listStands,
  listStandTags,
  removeStandTag,
  setStandScannable,
  setStandTagLabel,
  standQrTag,
} from "./stands.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

const enterpriseParam = { source: "params", field: "id" } as const;

/**
 * H43-H45: enterprise (sponsor) management and the public sponsor reveal.
 * Admins manage every enterprise incl. visibility/priority; sponsor reps edit
 * only their own profile. The public list is anonymous and driven by the
 * enterprise's own visibility window.
 */
export function registerSponsorRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.SPONSORS_MANAGE);

  // Public logo grid for the website / TV.
  r.get(
    "/api/public/sponsors",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        querystring: publicSponsorsQuery,
        summary: "List public sponsors",
        description:
          "Returns every visible enterprise for the public event site, ordered by priority (1 first); enterprises sharing a priority keep their manual order, then creation order. `kind=sponsor` or `kind=collaborator` filters to one group (H45).",
      },
    },
    async (req) => ({
      items: await sharedCache("public-content", `sponsors:${req.query.kind ?? "all"}`, 15, () =>
        listPublicSponsors(req.query.kind),
      ),
    }),
  );

  r.get(
    "/api/enterprises",
    {
      ...access({
        kind: "capability",
        anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
      }),
      preHandler: requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN),
      schema: {
        summary: "List enterprises",
        description:
          "Lists all sponsor enterprises, for global sponsor administrators and the Rooms admin page's enterprise picker (H43, H46).",
      },
    },
    async (req) => ({
      enterprises: await listEnterprises(actor(req.userId)),
    }),
  );

  r.post(
    "/api/enterprises",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        body: createEnterpriseBody,
        summary: "Create an enterprise",
        description: "Creates a sponsor enterprise under global sponsor administration (H43).",
      },
    },
    async (req, reply) => {
      const created = await createEnterprise(req.body, req.userId);
      reply.code(201);
      return created;
    },
  );

  // Admin bulk visibility flip from the enterprises list (H45).
  r.post(
    "/api/enterprises/visibility",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        body: bulkVisibilityBody,
        summary: "Set enterprise visibility",
        description: "Globally reveals or hides sponsor enterprises (H45).",
      },
    },
    async (req) => setEnterprisesVisibility(req.body.ids, req.body.visible, req.userId),
  );

  // Manual order inside one (kind, priority) group (H45).
  r.post(
    "/api/enterprises/reorder",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        body: reorderEnterprisesBody,
        summary: "Reorder enterprises within a group",
        description:
          "Sets the display order of enterprises that share the same priority; ids from different priorities are rejected (H45).",
      },
    },
    async (req) => reorderEnterprises(req.body.ids, req.userId),
  );

  // Sponsor rep's own enterprise (H44).
  r.get(
    "/api/enterprises/mine",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Get my enterprise",
        description: "Returns the caller's sponsor enterprise affiliation (H44).",
      },
    },
    async (req) => myEnterprise(actor(req.userId)),
  );

  r.get(
    "/api/enterprises/:id",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        summary: "Get a scoped enterprise",
        description:
          "Accessible to its sponsor representatives or a global sponsor administrator (H44).",
      },
    },
    async (req) => {
      return getEnterprise(req.params.id);
    },
  );

  r.patch(
    "/api/enterprises/:id",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: [requireEnterpriseAccess(enterpriseParam), idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        body: updateEnterpriseBody,
        summary: "Update a scoped enterprise",
        description:
          "Sponsor representatives may update their profile fields; global administrators may update all enterprise fields (H44).",
      },
    },
    async (req) => {
      if (enterpriseAccessFor(req) === "owner") {
        const disallowed = Object.keys(req.body).filter(
          (k) => !OWNER_EDITABLE_KEYS.includes(k as (typeof OWNER_EDITABLE_KEYS)[number]),
        );
        if (disallowed.length > 0)
          throw new ForbiddenError(
            `Sponsors may only edit ${OWNER_EDITABLE_KEYS.join(", ")}; not ${disallowed.join(", ")}`,
            { disallowed },
          );
      }
      return updateEnterprise(req.params.id, req.body, req.userId);
    },
  );

  // ── M4: enterprise membership (the affiliated users) ────────────────────────
  r.get(
    "/api/enterprises/:id/members",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        params: enterpriseIdParam,
        summary: "List enterprise members",
        description: "Lists sponsor affiliations for a globally managed enterprise (H43).",
      },
    },
    async (req) => ({ members: await listEnterpriseMembers(req.params.id, actor(req.userId)) }),
  );

  r.post(
    "/api/enterprises/:id/members",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        body: addMemberBody,
        summary: "Add enterprise member",
        description:
          "Affiliates an account with an enterprise under global sponsor administration (H43).",
      },
    },
    async (req, reply) => {
      const member = await addEnterpriseMember(req.params.id, req.body.userId, req.userId);
      reply.code(201);
      return member;
    },
  );

  r.delete(
    "/api/enterprises/:id/members/:userId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: memberParams,
        summary: "Remove enterprise member",
        description:
          "Removes an exact enterprise-to-user affiliation under global sponsor administration (H43).",
      },
    },
    async (req) => {
      await removeEnterpriseMember(req.params.id, req.params.userId, req.userId);
      return { removed: true as const };
    },
  );

  // ── judge roster (DELTA(Hxx)) ───────────────────────────────────────────────
  // Judges belong to an enterprise, not to a room: whoever is on this roster
  // judges in every room currently serving one of the enterprise's challenges.
  const judgePolicy = {
    kind: "contextual",
    policy: "enterprise-judge-manage",
    resource: enterpriseParam,
  } as const;

  r.get(
    "/api/enterprises/:id/judges",
    {
      ...access(judgePolicy),
      preHandler: requireEnterpriseJudgeManager(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        summary: "List enterprise judges",
        description:
          "The enterprise's judge roster. Roster membership grants judging access to every room currently serving one of the enterprise's challenges (H46). Readable by a queue:admin or the enterprise's own representatives.",
      },
    },
    async (req) => ({ judges: await listEnterpriseJudges(req.params.id, actor(req.userId)) }),
  );

  r.get(
    "/api/enterprises/:id/judge-candidates",
    {
      ...access(judgePolicy),
      preHandler: requireEnterpriseJudgeManager(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        summary: "List judge candidates",
        description:
          "Accounts that may be added to the enterprise's judge roster (H46). Deliberately unscoped: an enterprise may bring outside judges who are neither its representatives nor event participants.",
      },
    },
    async (req) => ({ users: await listJudgeCandidates(actor(req.userId)) }),
  );

  r.post(
    "/api/enterprises/:id/judges",
    {
      ...access(judgePolicy),
      preHandler: [requireEnterpriseJudgeManager(enterpriseParam), idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        body: addJudgeBody,
        summary: "Add enterprise judge",
        description:
          "Adds an account to the enterprise's judge roster (H46). The add is silent — the judge is not asked to confirm and gains the judging workspace on their next login. 409 if they are already on the roster.",
      },
    },
    async (req, reply) => {
      const judge = await addEnterpriseJudge(req.params.id, req.body.userId, req.userId);
      reply.code(201);
      return judge;
    },
  );

  r.delete(
    "/api/enterprises/:id/judges/:userId",
    {
      ...access(judgePolicy),
      preHandler: [requireEnterpriseJudgeManager(enterpriseParam), idempotencyGuard],
      schema: {
        params: judgeParams,
        summary: "Remove enterprise judge",
        description:
          "Removes an account from the enterprise's judge roster (H46), revoking its judging access to the enterprise's rooms and challenges.",
      },
    },
    async (req) => {
      await removeEnterpriseJudge(req.params.id, req.params.userId, req.userId);
      return { removed: true as const };
    },
  );

  // ── #935: company tags that attendees scan into their event diary ───────────
  // Staff (sponsors:manage) define a company's tags; they belong to the
  // company, never to a representative's or participant's profile. The
  // company's own reps may only read them.
  r.get(
    "/api/enterprises/:id/stand-tags",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        summary: "List company tags",
        description:
          "The company's tags: NFC tags or wristbands (by serial number, the 7-byte UID) and printable QR tokens, each with its kind, code, optional staff label and creation time. Attendees scan one to collect the company's badge in their event diary. Readable by the company's own sponsor representatives or a global sponsor administrator (#935).",
      },
    },
    async (req) => ({ tags: await listStandTags(actor(req.userId), req.params.id) }),
  );

  r.post(
    "/api/enterprises/:id/stand-tags",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        body: standTagBody,
        summary: "Add a company tag",
        description:
          "`kind: nfc` links an NFC tag or wristband by its serial number, the 7-byte UID (hex; separators ignored, stored uppercase like badges). `kind: qr` generates a printable `STAND-…` token. `label` is an optional staff label (≤40 characters). A code that is or was someone's badge, a ticket, or already a company tag answers 409 with `details.usedBy` (`badge`, `ticket` or `stand`). Global sponsor administrators only; audited (#935).",
      },
    },
    async (req, reply) => {
      const tag = await addStandTag(actor(req.userId), req.params.id, req.body);
      reply.code(201);
      return tag;
    },
  );

  r.patch(
    "/api/enterprises/:id/stand-tags/:tagId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: standTagParams,
        body: standTagLabelBody,
        summary: "Label a company tag",
        description:
          'Sets or clears (`null` or "") a tag\'s staff label, such as "Lanyard Ana" or "Table 3". Repeating the current label changes nothing and is not audited; a change is audited. Global sponsor administrators only (#935).',
      },
    },
    async (req) => {
      const { tag, changed } = await setStandTagLabel(
        actor(req.userId),
        req.params.id,
        req.params.tagId,
        req.body.label,
      );
      req.domainUnchanged = !changed;
      return tag;
    },
  );

  r.delete(
    "/api/enterprises/:id/stand-tags/:tagId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: standTagParams,
        summary: "Remove a company tag",
        description:
          "Unlinks a company tag; scanning it afterwards is an unknown code, and the wristband can be reused. Diary entries already saved for the company stay. Global sponsor administrators only; audited (#935).",
      },
    },
    async (req, reply) => {
      await removeStandTag(actor(req.userId), req.params.id, req.params.tagId);
      return reply.code(204).send();
    },
  );

  r.get(
    "/api/enterprises/:id/stand-tags/:tagId/qr.svg",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: standTagParams,
        summary: "Download a company QR as SVG",
        description:
          "A print-quality vector SVG (80 mm wide) of one QR company tag. The QR holds the tag link `https://<web host>/s/<token>`; the company name and the token are printed underneath. NFC tags and other companies' tags answer 404. The company's own sponsor representatives or a global sponsor administrator (#935).",
      },
    },
    async (req, reply) => {
      const { name, code } = await standQrTag(actor(req.userId), req.params.id, req.params.tagId);
      reply.header("content-type", "image/svg+xml; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${standQrFilename(name, code)}"`);
      reply.header("cache-control", "private, no-store");
      return reply.send(standQrSvg(code, name));
    },
  );

  // Staff company-tag management: which companies are scannable, codes for all.
  r.get(
    "/api/enterprises/stands",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        summary: "List company tags of every enterprise",
        description:
          "Every enterprise for the staff Company tags page: name, logos, visibility, whether attendees can collect it by scanning (`scannable`), its NFC and QR counts, the newest QR tag id and every tag (kind, serial number or token, label, creation time). Global sponsor administrators only (#935).",
      },
    },
    async (req) => ({ stands: await listStands(actor(req.userId)) }),
  );

  r.put(
    "/api/enterprises/:id/stand-scannable",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        body: standScannableBody,
        summary: "Set whether a company is scannable",
        description:
          "Turns collecting a company by scanning its tags on or off. While off, scanning its tags answers `stand_unavailable` and the company leaves attendees' collection, except for attendees who already collected it. Sponsor representatives cannot change it. Repeating the current value changes nothing and is not audited; a change is audited (#935).",
      },
    },
    async (req) => {
      const result = await setStandScannable(actor(req.userId), req.params.id, req.body.scannable);
      req.domainUnchanged = !result.changed;
      return result;
    },
  );

  r.post(
    "/api/enterprises/stands/qr",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        summary: "Generate missing company QR codes",
        description:
          "Generates one QR tag for every scannable company that has none and returns the created tags (`created`, empty when every scannable company already has a QR). Concurrent or repeated runs never create a second QR for the same company. Each created tag is audited. Global sponsor administrators only (#935).",
      },
    },
    async (req) => {
      const result = await generateMissingQrTags(actor(req.userId));
      req.domainUnchanged = result.created.length === 0;
      return result;
    },
  );

  r.get(
    "/api/enterprises/stands/codes.csv",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        summary: "Export company tag codes as CSV",
        description:
          "Every NFC serial number and QR token of the scannable companies as CSV (`enterprise_id,name,kind,code,label,url`, where `url` is the tag link), for printing with another tool. Codes are what attendees scan, so each export is audited with its size. 409 `stand_codes_empty` when no scannable company has a code. Global sponsor administrators only (#935).",
      },
    },
    async (req, reply) => {
      const codes = await exportStandCodes(actor(req.userId), "csv");
      return sendCsv(
        reply,
        "company-tags.csv",
        toCsv(
          ["enterprise_id", "name", "kind", "code", "label", "url"],
          codes.map((code) => [
            code.enterpriseId,
            code.name,
            code.kind,
            code.code,
            code.label,
            companyTagUrl(code.code),
          ]),
        ),
      );
    },
  );

  r.get(
    "/api/enterprises/stands/qr.zip",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        summary: "Download all company QR codes",
        description:
          "A zip with one print-quality SVG per QR tag of the scannable companies, each labelled with the company name and named `<company>-<token>.svg`. Audited like the CSV export. 409 `stand_codes_empty` when no scannable company has a QR. Global sponsor administrators only (#935).",
      },
    },
    async (req, reply) => {
      const codes = await exportStandCodes(actor(req.userId), "svg");
      // Every entry is a small in-memory string (no storage reads, unlike the
      // file exports), so nothing can fail once the zip starts streaming.
      const archive = new ZipArchive({ zlib: { level: 9 } });
      for (const code of codes) {
        archive.append(standQrSvg(code.code, code.name), {
          name: standQrFilename(code.name, code.code),
        });
      }
      void archive.finalize();
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="company-qr-codes.zip"`);
      reply.header("cache-control", "private, no-store");
      return reply.send(archive);
    },
  );

  // A user's enterprise affiliations — for the profile's Enterprise view.
  r.get(
    "/api/users/:id/enterprises",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        summary: "List a user's enterprises",
        description:
          "Lists sponsor enterprise affiliations for an account with global user-read access (H43).",
      },
    },
    async (req) => ({ enterprises: await listUserEnterprises(req.params.id, actor(req.userId)) }),
  );

  // Logo upload (H44 object storage) — the client POSTs the file as multipart;
  // the API stores it (so the browser never needs to reach the object store,
  // which is private behind the app network) and sets logo_url to the public
  // URL. NOTE: for the logo to *display*, S3_PUBLIC_URL must be a
  // browser-reachable host serving the bucket.
  r.post(
    "/api/enterprises/:id/logo",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: [requireEnterpriseAccess(enterpriseParam), idempotencyGuard],
      schema: {
        params: enterpriseIdParam,
        querystring: z.object({ variant: z.enum(["default", "negative"]).default("default") }),
        summary: "Upload enterprise logo",
        description:
          "Stores a logo for the caller's exact sponsor enterprise or for a global administrator (H44).",
      },
    },
    async (req) => {
      const file = await req.file();
      if (!file) throw new BadRequestError("No file uploaded");
      const ext = CONTENT_TYPE_EXT[file.mimetype as keyof typeof CONTENT_TYPE_EXT];
      if (!ext) {
        throw new BadRequestError(
          `Unsupported image type ${file.mimetype}. Allowed: ${Object.keys(CONTENT_TYPE_EXT).join(", ")}`,
        );
      }
      const bytes = await file.toBuffer();
      const operation = createHash("sha256")
        .update(req.idempotency?.key ?? `${Date.now()}-${Math.random()}`)
        .digest("hex")
        .slice(0, 32);
      const key = `enterprises/${req.params.id}/logo-${req.query.variant}-${operation}.${ext}`;
      const logoUrl = await putObject(key, bytes, file.mimetype);
      await setEnterpriseLogo(req.params.id, logoUrl, req.query.variant, req.userId);
      return { logoUrl, variant: req.query.variant };
    },
  );

  // H58: sponsor-only logistics/FAQ page (venue, load-in window, merch
  // drop-off, point of contact) — not the public site, and not everyone with
  // portal access (judges are excluded; see requireSponsorPortalAccess).
  r.get(
    "/api/sponsor-faq",
    {
      ...access({ kind: "contextual", policy: "sponsor-portal-access" }),
      preHandler: requireSponsorPortalAccess,
      schema: {
        summary: "Read sponsor FAQ",
        description:
          "Ordered list of trilingual FAQ items for sponsor reps (H58): question/answer pairs (kind='qa') and free-form text blocks (kind='text'), e.g. venue, load-in window, merch drop-off deadline. Readable by any linked sponsor representative or a SPONSORS_MANAGE admin.",
      },
    },
    async () => getSponsorFaq(),
  );

  r.put(
    "/api/sponsor-faq",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: [manage, idempotencyGuard],
      schema: {
        body: sponsorFaqBody,
        summary: "Update sponsor FAQ",
        description:
          "Replaces the sponsor FAQ items wholesale (H58), each trilingual (en/es/gl). SPONSORS_MANAGE only.",
      },
    },
    async (req) => updateSponsorFaq(actor(req.userId), req.body.items),
  );
}
