import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { putObject } from "../../lib/storage.js";
import type { TemplateField } from "./schemas.js";

const uploadParamsSchema = z.object({
  applicationId: z.coerce.number().int().positive(),
  fieldKey: z.string().min(1),
});

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

      const key = `uploads/${applicationId}/${userId}/${fieldKey}-${Date.now()}${ext}`;
      const url = await putObject(key, bytes, file.mimetype);

      return { key, url };
    },
  );
}
