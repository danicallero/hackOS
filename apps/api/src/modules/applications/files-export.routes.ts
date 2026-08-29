import type { Readable } from "node:stream";
import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ZipArchive } from "archiver";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { getObject, objectExists } from "../../lib/storage.js";
import type { TemplateField } from "./schemas.js";

const exportParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  fieldKey: z.string().min(1),
});

const exportQuerySchema = z.object({
  scope: z.enum(["all", "shared"]).default("all"),
});

/** Extension (including the dot) of a stored upload key's original filename, or "". */
function keyExtension(key: string): string {
  const name = key.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

interface ExportRow {
  response_id: number;
  user_id: number;
  email: string;
  file_key: string;
}

interface ExportFailure {
  responseId: number;
  userId: number;
  email: string;
}

/** Response headers can't grow unbounded — cap the inline failure list and
 *  let the count speak for the rest; every failure is still fully recorded
 *  in audit_log, not just this header. */
const MAX_FAILURES_IN_HEADER = 50;

/**
 * H56: bulk-export every file uploaded to one "file" template field, or only
 * the ones applicants agreed to share with sponsors, zipped and named by
 * applicant email. Read-heavy, so it's gated by the same exports:run
 * capability as the other operational CSV exports (H54) rather than a new one.
 */
export function registerFilesExportRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/applications/:id/fields/:fieldKey/files.zip",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        summary: "Bulk-export a file field's uploads as a zip",
        description:
          "Streams every uploaded file for a template field of kind 'file' as a zip, one entry per applicant named '<email><ext>' (H56). `scope=shared` restricts the export to responses where the applicant consented to share that file with sponsors — only valid for fields the organizer marked shareable_with_sponsors. Any upload missing from storage is skipped rather than failing the whole export; when that happens the response carries an `x-export-file-failures` header (JSON: `{ total, items: [{ responseId, userId, email }] }`, capped at 50 items) and each failure is recorded in the audit log against its response, so staff can find and fix the affected applications.",
        params: exportParamsSchema,
        querystring: exportQuerySchema,
      },
    },
    async (req, reply) => {
      const { id: applicationId, fieldKey } = req.params;
      const { scope } = req.query;

      const { rows: appRows } = await pool.query(
        `SELECT template FROM applications WHERE id = $1`,
        [applicationId],
      );
      if (!appRows[0]) throw new NotFoundError("Application not found");

      const template = appRows[0].template as TemplateField[];
      const field = template.find((f) => f.key === fieldKey);
      if (field?.kind !== "file") {
        throw new BadRequestError("No file field found with that key");
      }
      if (scope === "shared" && !field.shareable_with_sponsors) {
        throw new BadRequestError("This field is not configured as shareable with sponsors");
      }

      const consentKey = sponsorShareKey(fieldKey);
      const { rows } = await pool.query<ExportRow>(
        `SELECT r.id AS response_id, r.user_id, u.email, r.responses->>$2 AS file_key
           FROM application_responses r
           JOIN users u ON u.id = r.user_id
          WHERE r.application_id = $1
            AND u.account_state = 'active' AND u.anonymized_at IS NULL
            AND u.is_test_account = false
            AND r.responses ? $2
            AND ($3::text <> 'shared' OR (r.responses->>$4)::boolean IS TRUE)
          ORDER BY u.email`,
        [applicationId, fieldKey, scope, consentKey],
      );

      // Pre-flight: find out which files are actually readable BEFORE
      // committing to the streamed zip response below. Past that point,
      // headers are sent and an error can no longer become a clean HTTP
      // response — a missing object would instead hang the connection (the
      // proxy in front of this API sees that as a 502). Checking first lets
      // every failure be reported (audit_log, per-response) and surfaced to
      // the caller via a response header instead.
      const goodRows: ExportRow[] = [];
      const failures: ExportFailure[] = [];
      for (const row of rows) {
        if (!row.file_key) continue;
        if (await objectExists(row.file_key)) {
          goodRows.push(row);
        } else {
          failures.push({ responseId: row.response_id, userId: row.user_id, email: row.email });
        }
      }

      for (const failure of failures) {
        await audit(pool, {
          actorId: req.userId,
          entityType: "application_response",
          entityId: failure.responseId,
          action: "export_file_unreadable",
          reason: `Field '${fieldKey}' upload missing from storage during export`,
        });
      }
      await audit(pool, {
        actorId: req.userId,
        entityType: "application_field_export",
        entityId: `${applicationId}:${fieldKey}`,
        action: "export",
        after: {
          scope,
          field_key: fieldKey,
          file_count: goodRows.length,
          failed_count: failures.length,
        },
      });

      const filename = `${fieldKey}-${scope}.zip`;
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      reply.header("cache-control", "private, no-store");
      // Read by the web client to surface exactly which applications need
      // manual attention (their upload is missing from storage) — set before
      // reply.send() below since headers can't change once streaming starts.
      if (failures.length > 0) {
        reply.header(
          "x-export-file-failures",
          JSON.stringify({
            total: failures.length,
            items: failures.slice(0, MAX_FAILURES_IN_HEADER),
          }),
        );
      }

      const archive = new ZipArchive({ zlib: { level: 9 } });
      // Still defensive from here on: an object can vanish between the check
      // above and this read (rare, but the same "one row's failure never
      // aborts the rest" guard as before costs nothing to keep).
      const sent = reply.send(archive);
      try {
        for (const row of goodRows) {
          try {
            const obj = await getObject(row.file_key);
            if (!obj.Body) continue;
            archive.append(obj.Body as Readable, {
              name: `${row.email}${keyExtension(row.file_key)}`,
            });
          } catch (err) {
            req.log.warn(
              { err, fieldKey, fileKey: row.file_key, email: row.email },
              "files-export: skipping a file that could not be read from storage",
            );
          }
        }
        await archive.finalize();
      } catch (err) {
        req.log.error({ err, fieldKey }, "files-export: failed to finalize the zip");
      }
      return sent;
    },
  );
}
