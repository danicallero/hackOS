import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import sharp from "sharp";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth } from "../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { isPdf, sniffPhoto, uploadOperation } from "../../lib/profile-files.js";
import { getObject, putObject } from "../../lib/storage.js";
import { nativeEditable, nativeForm, nativeProject } from "./native.js";
import { canViewProject } from "./policy.js";

const params = z.object({ id: z.coerce.number().int().positive() });
const publicRead = {
  config: {
    routeAccessPolicy: { kind: "public" as const, anonymousCategory: "public-content" as const },
  },
};
export function registerProjectFileRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post(
    "/api/me/projects/:id/uploads",
    {
      config: { routeAccessPolicy: { kind: "authenticated" } },
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params,
        querystring: z.object({ fieldKey: z.string().min(1) }),
        summary: "Upload project file",
        description:
          "Uploads sniffed, size-limited private project files under an idempotent project key; image thumbnails use the same phase authorization (#1007).",
      },
    },
    async (q) => {
      const form = await nativeForm();
      const field = form.template.find((f: { key: string }) => f.key === q.query.fieldKey);
      if (field?.kind !== "file" && field?.kind !== "images")
        throw new BadRequestError("Not a project file field");
      const file = await q.file();
      if (!file) throw new BadRequestError("No file uploaded");
      const maximum = Math.min(field.max_file_size_mb ?? 5, 20) * 1024 * 1024;
      const bytes = await file.toBuffer();
      if (file.file.truncated || bytes.length > maximum)
        throw new BadRequestError("File exceeds size limit");
      const photo = sniffPhoto(bytes);
      const mime = photo?.contentType ?? (isPdf(bytes) ? "application/pdf" : null);
      if (!mime) throw new BadRequestError("Unsupported file contents");
      // H16: a photo field takes photos only, whatever its allowed types say.
      if (field.kind === "images" && !photo) throw new BadRequestError("File type is not allowed");
      const extension = photo?.ext ?? "pdf";
      const allowed = field.allowed_file_types as string[] | undefined;
      if (
        allowed?.length &&
        !allowed.some(
          (type) =>
            type === mime ||
            type === `.${extension}` ||
            type === extension ||
            (type === "image/*" && mime.startsWith("image/")),
        )
      )
        throw new BadRequestError("File type is not allowed");
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const key = `projects/${q.params.id}/${uploadOperation(q)}/${digest}.${extension}`;
      const thumbnail = photo ? `${key}.thumbnail.webp` : null;
      return withTransaction(async (db) => {
        await nativeEditable(db, q.userId as number, q.params.id);
        await putObject(key, bytes, mime);
        if (thumbnail)
          await putObject(
            thumbnail,
            await sharp(bytes)
              .rotate()
              .resize({ width: 640, height: 480, fit: "inside", withoutEnlargement: true })
              .webp()
              .toBuffer(),
            "image/webp",
          );
        await db.query(
          `INSERT INTO project_files(object_key,repo_id,uploaded_by,field_key,filename,mime_type,size_bytes,thumbnail_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(object_key) DO NOTHING`,
          [
            key,
            q.params.id,
            q.userId,
            q.query.fieldKey,
            file.filename,
            mime,
            bytes.length,
            thumbnail,
          ],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "project",
          entityId: q.params.id,
          action: "file_upload",
          after: { key, fieldKey: q.query.fieldKey },
        });
        return {
          objectKey: key,
          url: `/api/public/projects/${q.params.id}/files?key=${encodeURIComponent(key)}`,
          thumbnailUrl: thumbnail
            ? `/api/public/projects/${q.params.id}/files?key=${encodeURIComponent(key)}&thumbnail=true`
            : null,
          fileName: file.filename,
          mimeType: mime,
          size: bytes.length,
        };
      });
    },
  );
  r.get(
    "/api/public/projects/:id/files",
    {
      ...publicRead,
      schema: {
        params,
        querystring: z.object({ key: z.string(), thumbnail: z.coerce.boolean().default(false) }),
        summary: "Read project file",
        description:
          "Authorizes each download through project visibility; copied storage keys confer no access (#1007,#1008).",
      },
    },
    async (q, reply) => {
      if (!(await canViewProject(pool, q.userId, q.params.id)))
        throw new NotFoundError("File not found");
      const { rows } = await pool.query(
        `SELECT mime_type,thumbnail_key FROM project_files WHERE repo_id=$1 AND object_key=$2`,
        [q.params.id, q.query.key],
      );
      if (!rows[0]) throw new NotFoundError("File not found");
      const project = await nativeProject(q.userId, q.params.id);
      if (!project?.files.some((file: { objectKey: string }) => file.objectKey === q.query.key))
        throw new NotFoundError("File not found");
      const key = q.query.thumbnail ? rows[0].thumbnail_key : q.query.key;
      if (!key) throw new NotFoundError("Thumbnail not found");
      const object = await getObject(key);
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .type(q.query.thumbnail ? "image/webp" : rows[0].mime_type);
      return reply.send(object.Body as Readable);
    },
  );
  r.get(
    "/api/public/projects/:id/members/:userId/photo",
    {
      ...publicRead,
      schema: {
        params: params.extend({ userId: z.coerce.number().int().positive() }),
        summary: "Read consented gallery photo",
        description:
          "Requires current project visibility, active membership and explicit gallery photo consent on every request (#1009).",
      },
    },
    async (q, reply) => {
      if (!(await canViewProject(pool, q.userId, q.params.id)))
        throw new NotFoundError("Photo not found");
      const { rows } = await pool.query(
        `SELECT u.photo_key FROM users u JOIN submissions s ON s.user_id=u.id AND s.status='active' WHERE s.repo_id=$1 AND u.id=$2 AND u.gallery_show_photo AND u.gallery_consented_at IS NOT NULL AND u.account_state='active' AND u.anonymized_at IS NULL`,
        [q.params.id, q.params.userId],
      );
      if (!rows[0]?.photo_key) throw new NotFoundError("Photo not found");
      const object = await getObject(rows[0].photo_key);
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .type(object.ContentType ?? "image/jpeg");
      return reply.send(object.Body as Readable);
    },
  );
}
