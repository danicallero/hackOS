import type { Readable } from "node:stream";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, userHasCapability } from "../../lib/capabilities.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { getObject, putObject } from "../../lib/storage.js";
import type { TemplateField } from "./schemas.js";

const uploadParamsSchema = z.object({
  applicationId: z.coerce.number().int().positive(),
  fieldKey: z.string().min(1),
});

const downloadQuerySchema = z.object({ key: z.string().min(1) });

/** Keep the applicant's original filename but strip anything path-unsafe, so the
 *  stored key's last segment is a clean, human name (not timestamped gibberish). */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 120);
}

/**
 * File upload endpoint for application form file fields (kind: "file"). The
 * client reads allowed_file_types and max_file_size_mb from the field
 * definition in the template, then POSTs here. The server validates against
 * those restrictions and stores the file in MinIO.
 */
export function registerUploadRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/applications/:applicationId/upload/:fieldKey",
    {
      preHandler: requireAuth,
      schema: { params: uploadParamsSchema },
    },
    async (req) => {
      const { applicationId, fieldKey } = req.params;
      const userId = req.userId as number;

      // Look up the application template to find the field definition
      const { rows: appRows } = await pool.query(
        `SELECT template, type FROM applications WHERE id = $1`,
        [applicationId],
      );
      if (!appRows[0]) throw new NotFoundError("Application not found");

      const template = appRows[0].template as TemplateField[];
      const field = template.find((f) => f.key === fieldKey);
      if (field?.kind !== "file") {
        throw new BadRequestError("No file field found with that key");
      }

      const allowedTypes = field.allowed_file_types ?? [
        ".pdf",
        ".doc",
        ".docx",
        ".png",
        ".jpg",
        ".jpeg",
      ];
      const maxSizeMb = field.max_file_size_mb ?? 10;
      const maxSizeBytes = maxSizeMb * 1024 * 1024;

      const file = await req.file();
      if (!file) throw new BadRequestError("No file uploaded");

      const name = file.filename ?? "upload";
      const ext = `.${(name.split(".").pop() ?? "").toLowerCase()}`;
      if (!allowedTypes.includes(ext)) {
        throw new BadRequestError(
          `File type ${ext} is not allowed. Allowed: ${allowedTypes.join(", ")}`,
        );
      }

      const bytes = await file.toBuffer();
      if (bytes.length > maxSizeBytes) {
        throw new BadRequestError(`File exceeds maximum size of ${maxSizeMb}MB`);
      }

      // Key: uploads/<appId>/<userId>/<fieldKey>/<ts>/<original-name>. The unique
      // timestamp is a hidden path segment so the LAST segment is the clean
      // original filename (shown in the UI); the userId segment drives authz.
      const key = `uploads/${applicationId}/${userId}/${fieldKey}/${Date.now()}/${safeFilename(name)}`;
      // The bucket's uploads/ prefix is private (H12): store the KEY in the
      // response, not a URL. Reads are proxied by the owner-or-staff route below.
      await putObject(key, bytes, file.mimetype);

      return { key, filename: safeFilename(name) };
    },
  );

  // Download a private application upload (H12). The bytes are PROXIED (not
  // presigned), so the owner-or-staff check runs on THIS request's session:
  // copying the link gives nothing to anyone who isn't the owner (userId encoded
  // in the key path uploads/<appId>/<userId>/…) or staff who can review.
  r.get(
    "/api/files/download",
    { preHandler: requireAuth, schema: { querystring: downloadQuerySchema } },
    async (req, reply) => {
      const { key } = req.query;
      if (!key.startsWith("uploads/") || key.includes("..")) {
        throw new BadRequestError("Not a downloadable file key");
      }
      const ownerId = Number(key.split("/")[2]);
      if (!Number.isInteger(ownerId)) throw new BadRequestError("Malformed file key");

      const userId = req.userId as number;
      const isOwner = userId === ownerId;
      const isStaff = isOwner
        ? false
        : await userHasCapability(userId, CAPABILITIES.APPLICATIONS_REVIEW);
      if (!isOwner && !isStaff) {
        throw new ForbiddenError("You don't have access to this file");
      }

      let obj: Awaited<ReturnType<typeof getObject>>;
      try {
        obj = await getObject(key);
      } catch {
        throw new NotFoundError("File not found");
      }
      if (!obj.Body) throw new NotFoundError("File not found");

      const filename = (key.split("/").pop() ?? "file").replace(/["\\]/g, "");
      reply.header("content-type", obj.ContentType ?? "application/octet-stream");
      if (obj.ContentLength != null) reply.header("content-length", String(obj.ContentLength));
      reply.header("content-disposition", `inline; filename="${filename}"`);
      // Never let a shared proxy/CDN cache a private file.
      reply.header("cache-control", "private, no-store");
      return reply.send(obj.Body as Readable);
    },
  );
}
