import { randomUUID } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  WALLET_ARTWORK_SLOTS,
  type WalletArtworkScale,
  type WalletSettings,
} from "@hackos/shared/wallet-settings";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { requireIdempotencyKey } from "../../lib/idempotency.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { isSyntheticOperator } from "./review-fixture-scope.js";
import { createWalletOperation, operationSummary } from "./wallet-operations.js";
import {
  readBundledAppleArtwork,
  readWalletArtwork,
  readWalletSettings,
  resetWalletArtwork,
  resetWalletSettings,
  saveWalletSettings,
  uploadWalletArtwork,
} from "./wallet-settings.js";

const protectedApple = [
  "formatVersion",
  "serialNumber",
  "authenticationToken",
  "webServiceURL",
  "passTypeIdentifier",
  "teamIdentifier",
  "voided",
  "barcodes",
  "barcode",
  "boardingPass",
  "generic",
  "storeCard",
  "coupon",
];
const protectedGoogle = [
  "id",
  "classId",
  "eventId",
  "state",
  "barcode",
  "rotatingBarcode",
  "reviewStatus",
];
function options(forbidden: string[]) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    for (const key of forbidden)
      if (key in value)
        ctx.addIssue({ code: "custom", message: `${key} is managed by hackOS`, path: [key] });
    if (value.eventTicket !== undefined) {
      const parsed = z
        .object({
          backFields: z
            .array(
              z.object({ key: z.string(), value: z.union([z.string(), z.number()]) }).passthrough(),
            )
            .optional(),
        })
        .passthrough()
        .safeParse(value.eventTicket);
      if (!parsed.success)
        ctx.addIssue({
          code: "custom",
          message: "eventTicket must contain valid pass fields",
          path: ["eventTicket"],
        });
    }
    if (JSON.stringify(value).length > 50_000)
      ctx.addIssue({ code: "custom", message: "Pass options exceed 50 KB" });
  });
}
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Use an HTTPS URL");
const appOrHttpsUrl = z.string().refine((value) => {
  if (/^https:\/\//i.test(value)) return URL.canParse(value);
  return (
    /^(?!javascript:|data:|file:)[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(value) &&
    !/^(javascript|data|file):/i.test(value)
  );
}, "Use an app or HTTPS link");
const settingsBody = z
  .object({
    backgroundColor: color,
    foregroundColor: color,
    labelColor: color,
    websiteUrl: httpsUrl,
    showDirections: z.boolean(),
    showSchedule: z.boolean(),
    scheduleUrl: appOrHttpsUrl,
    appleAppStoreId: z.number().int().positive().nullable(),
    androidPackageName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/),
    androidStoreUrl: httpsUrl,
    appleOptions: options(protectedApple),
    googleClassOptions: options(protectedGoogle),
    googleObjectOptions: options(protectedGoogle),
  })
  .strict();
const slotParams = z.object({ slot: z.enum(WALLET_ARTWORK_SLOTS) });
const translation = z
  .object({ title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(500) })
  .strict();
export function registerWalletAdminRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const capability = { kind: "capability", capability: CAPABILITIES.WALLET_MANAGE } as const;
  r.get(
    "/api/event/wallet",
    {
      ...access(capability),
      schema: {
        summary: "Read Wallet appearance and actions",
        description:
          "Runtime Apple/Google Wallet customization (H28). Certificates, provider accounts, pass identity and QR credentials stay managed by hackOS.",
      },
    },
    async () => readWalletSettings(),
  );
  r.put(
    "/api/event/wallet",
    {
      ...access(capability),
      schema: {
        body: settingsBody,
        summary: "Save Wallet appearance and actions",
        description:
          "Audited event-wide customization (H28/H53). Colors, links, app targets and native provider options apply to new passes and enqueue an update for existing passes.",
      },
    },
    async (req) =>
      saveWalletSettings(
        req.userId!,
        req.body as Omit<WalletSettings, "artwork" | "artworkDefaults">,
      ),
  );
  r.delete(
    "/api/event/wallet",
    {
      ...access(capability),
      schema: {
        summary: "Restore deployment Wallet defaults",
        description:
          "Clears appearance/action/native-option overrides so every field inherits the deployment environment. Artwork selections are reset separately. Audited and queued for existing passes (H28).",
      },
    },
    async (req) => resetWalletSettings(req.userId!),
  );
  r.post(
    "/api/event/wallet/artwork/:slot",
    {
      ...access(capability),
      preHandler: requireIdempotencyKey,
      schema: {
        params: slotParams,
        summary: "Upload Wallet artwork",
        description:
          "Upload PNG/JPEG/WebP artwork up to 5 MB per file (H28). Apple accepts file, file2x and file3x in one request; missing scales are derived from the highest supplied image. hackOS stores normalized PNGs in S3, serves immutable public URLs and queues pass updates.",
      },
    },
    async (req) => {
      const files: Partial<Record<WalletArtworkScale, Buffer>> = {};
      for await (const file of req.files({ limits: { files: 3, fileSize: 5 * 1024 * 1024 } })) {
        const scale = { file: 1, file2x: 2, file3x: 3 }[file.fieldname];
        if (!scale || files[scale as WalletArtworkScale])
          throw new BadRequestError("Invalid image variant");
        files[scale as WalletArtworkScale] = await file.toBuffer();
      }
      return uploadWalletArtwork(req.userId!, req.params.slot, files);
    },
  );
  r.delete(
    "/api/event/wallet/artwork/:slot",
    {
      ...access(capability),
      schema: {
        params: slotParams,
        summary: "Reset Wallet artwork",
        description:
          "Restore the bundled Apple image or deployment Google image for this slot (H28). Previously published revisions remain available for provider caches.",
      },
    },
    async (req) => resetWalletArtwork(req.userId!, req.params.slot),
  );
  r.get(
    "/api/wallet/artwork/default/:slot/:scale.png",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        params: z.object({
          slot: z.enum(["appleIcon", "appleLogo", "appleStrip"]),
          scale: z.coerce.number().int().min(1).max(3),
        }),
        summary: "Read bundled Apple Wallet artwork",
        description:
          "Serves the exact 1×/2×/3× Apple images bundled into default passes for the Wallet editor preview (H28). A missing bundled variant returns 404.",
      },
    },
    async (req, reply) =>
      reply
        .type("image/png")
        .header("cache-control", "public, max-age=3600")
        .send(
          await readBundledAppleArtwork(req.params.slot, req.params.scale as WalletArtworkScale),
        ),
  );
  r.get(
    "/api/wallet/artwork/:id/:scale.png",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        params: z.object({ id: z.string().uuid(), scale: z.coerce.number().int().min(1).max(3) }),
        summary: "Read published Wallet artwork",
        description:
          "Public, immutable normalized PNG artwork (H28). Only published artwork IDs are served; no user-upload storage paths or private files are accepted.",
      },
    },
    async (req, reply) =>
      reply
        .type("image/png")
        .header("cache-control", "public, max-age=31536000, immutable")
        .send(await readWalletArtwork(req.params.id, req.params.scale)),
  );
  r.post(
    "/api/event/wallet/operations",
    {
      ...access(capability),
      preHandler: requireIdempotencyKey,
      schema: {
        body: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("refresh") }).strict(),
          z
            .object({
              kind: z.literal("alert"),
              translations: z
                .object({ es: translation, gl: translation, en: translation })
                .strict(),
            })
            .strict(),
        ]),
        summary: "Request Wallet refresh or send an event alert",
        description:
          "Durably queues a manual refresh or trilingual event alert (H28/H53). Scoped to real/test recipients, audited, and idempotent. Alerts are capped at three per 24 hours. Sent means accepted by the provider, not guaranteed display; notification preferences and device connectivity apply.",
      },
    },
    async (req, reply) =>
      reply
        .code(202)
        .send(
          await createWalletOperation(
            req.userId!,
            req.idempotency?.key ?? randomUUID(),
            req.body.kind,
            "translations" in req.body ? req.body.translations : undefined,
          ),
        ),
  );
  r.get(
    "/api/event/wallet/operations/:id",
    {
      ...access(capability),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        summary: "Read Wallet operation delivery counts",
        description:
          "Counts of queued, provider-accepted, failed and skipped pass deliveries for an alert/refresh (H28). Real and synthetic operations are isolated.",
      },
    },
    async (req) => {
      const synthetic = await isSyntheticOperator(pool, req.userId!);
      const op = await pool.query(
        `SELECT 1 FROM wallet_operations WHERE id=$1 AND is_test_account=$2`,
        [req.params.id, synthetic],
      );
      if (!op.rowCount) throw new NotFoundError();
      return operationSummary(req.params.id);
    },
  );
}
