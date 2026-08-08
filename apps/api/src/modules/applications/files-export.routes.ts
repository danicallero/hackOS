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
import { getObject } from "../../lib/storage.js";
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
          "Streams every uploaded file for a template field of kind 'file' as a zip, one entry per applicant named '<email><ext>' (H56). `scope=shared` restricts the export to responses where the applicant consented to share that file with sponsors — only valid for fields the organizer marked shareable_with_sponsors.",
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
      const { rows } = await pool.query<{ email: string; file_key: string }>(
        `SELECT u.email, r.responses->>$2 AS file_key
           FROM application_responses r
           JOIN users u ON u.id = r.user_id
          WHERE r.application_id = $1
            AND r.responses ? $2
            AND ($3::text <> 'shared' OR (r.responses->>$4)::boolean IS TRUE)
          ORDER BY u.email`,
        [applicationId, fieldKey, scope, consentKey],
      );

      await audit(pool, {
        actorId: req.userId,
        entityType: "application_field_export",
        entityId: `${applicationId}:${fieldKey}`,
        action: "export",
        after: { scope, field_key: fieldKey, file_count: rows.length },
      });

      const filename = `${fieldKey}-${scope}.zip`;
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      reply.header("cache-control", "private, no-store");

      const archive = new ZipArchive({ zlib: { level: 9 } });
      // Headers are already committed once reply.send(archive) runs below, so
      // ANY error past this point can no longer become a clean HTTP error
      // response — it just kills the connection mid-stream (a 502 at any
      // reverse proxy in front of this). One missing/unreadable object (e.g.
      // deleted from storage after upload) must never take the whole export
      // down with it, so each file is fetched defensively and skipped on
      // failure — matches the "one row's failure never aborts the rest"
      // convention used by the batch decide/send/revert helpers.
      const sent = reply.send(archive);
      try {
        for (const row of rows) {
          if (!row.file_key) continue;
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
