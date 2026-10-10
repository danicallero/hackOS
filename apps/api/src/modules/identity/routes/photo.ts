import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, type Queryable, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  getRequestAuthorizationContext,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../../lib/capabilities.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../../lib/errors.js";
import { idempotencyGuard, requireIdempotencyKey } from "../../../lib/idempotency.js";
import {
  deleteReplacedObject,
  PHOTO_MAX_BYTES,
  photoContentType,
  photoUrl,
  profilePrefix,
  readUpload,
  sendProfileObject,
  sniffPhoto,
  uploadOperation,
} from "../../../lib/profile-files.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { putObject } from "../../../lib/storage.js";
import { photoPublishedInDirectory, savedByReader } from "../../directory/service.js";
import { assertFixtureSubjectScope } from "../../logistics/review-fixture-scope.js";
import { hasEventAccess } from "../role.js";

/**
 * Account photo (#934). The owner uploads it to private object storage; it
 * is never served from a public bucket URL. `GET /api/users/:id/photo`
 * re-checks access on every request: the person, staff who can read users,
 * or a directory reader (or an attendee who saved the person, #935) while the
 * person shows the photo in the directory.
 */

const photoParams = z.object({ id: z.coerce.number().int().positive() });
const photoResponse = z.object({ image: z.string().nullable() });

/** Everyone else gets the same 404, so a photo's existence cannot be probed. */
async function canSeePhoto(req: FastifyRequest, subjectId: number): Promise<boolean> {
  const readerId = req.userId as number;
  if (readerId === subjectId) return true;
  const context = getRequestAuthorizationContext(req);
  if (await userHasCapability(context, CAPABILITIES.USERS_READ)) {
    try {
      await assertFixtureSubjectScope(pool, readerId, subjectId);
      return true;
    } catch (err) {
      if (err instanceof AppError) return false;
      throw err;
    }
  }
  return (
    ((await userHasCapability(context, CAPABILITIES.DIRECTORY_READ)) ||
      (await savedByReader(pool, readerId, subjectId))) &&
    (await hasEventAccess(pool, readerId)) &&
    (await photoPublishedInDirectory(pool, subjectId))
  );
}

/**
 * Lock the active owner; H54 removal takes the same row lock. `missing` is
 * what an absent account answers: 401 for the caller's own session, 404 for a
 * staff target.
 */
async function lockPhotoOwner(
  db: Queryable,
  userId: number,
  missing: () => AppError,
): Promise<string | null> {
  const { rows } = await db.query<{ account_state: string; photo_key: string | null }>(
    `SELECT account_state, photo_key FROM users
      WHERE id = $1 AND anonymized_at IS NULL
      FOR NO KEY UPDATE`,
    [userId],
  );
  if (!rows[0]) throw missing();
  if (rows[0].account_state === "removal_pending") {
    throw new ConflictError("This account is being removed");
  }
  return rows[0].photo_key;
}

/** Who is changing whose photo: the owner themself, or user staff (H8). */
interface PhotoChange {
  actorId: number;
  subjectId: number;
  source: "participant" | "admin";
  missing: () => AppError;
}

/** Store a new photo for the subject and audit it in the same transaction (H53). */
async function replacePhoto(req: FastifyRequest, change: PhotoChange) {
  const { actorId, subjectId, source, missing } = change;
  const { bytes } = await readUpload(req, PHOTO_MAX_BYTES);
  const type = sniffPhoto(bytes);
  if (!type) throw new BadRequestError("The photo must be a PNG, JPEG or WebP image");
  const key = `${profilePrefix(subjectId)}photo/${uploadOperation(req)}.${type.ext}`;
  const previous = await withTransaction(async (db) => {
    const before = await lockPhotoOwner(db, subjectId, missing);
    await putObject(key, bytes, type.contentType);
    await db.query(`UPDATE users SET photo_key = $2, photo_updated_at = now() WHERE id = $1`, [
      subjectId,
      key,
    ]);
    await audit(db, {
      actorId,
      entityType: "user",
      entityId: subjectId,
      action: "user.photo_updated",
      before: { hasPhoto: before !== null },
      after: { hasPhoto: true },
      source,
    });
    return before;
  });
  await deleteReplacedObject(req, previous !== key ? previous : null);
  return { image: photoUrl(subjectId, key) };
}

/** Clear the subject's photo; removing when there is none changes nothing. */
async function clearPhoto(req: FastifyRequest, change: PhotoChange) {
  const { actorId, subjectId, source, missing } = change;
  const removed = await withTransaction(async (db) => {
    const before = await lockPhotoOwner(db, subjectId, missing);
    if (!before) return null;
    await db.query(`UPDATE users SET photo_key = NULL, photo_updated_at = NULL WHERE id = $1`, [
      subjectId,
    ]);
    await audit(db, {
      actorId,
      entityType: "user",
      entityId: subjectId,
      action: "user.photo_removed",
      before: { hasPhoto: true },
      after: { hasPhoto: false },
      source,
    });
    return before;
  });
  req.domainUnchanged = removed === null;
  await deleteReplacedObject(req, removed);
  return { image: null };
}

function ownChange(req: FastifyRequest): PhotoChange {
  const userId = req.userId as number;
  return {
    actorId: userId,
    subjectId: userId,
    source: "participant",
    missing: () => new UnauthorizedError(),
  };
}

/** Staff change: the same synthetic-account boundary as every user edit (H8). */
async function staffChange(req: FastifyRequest, subjectId: number): Promise<PhotoChange> {
  const actorId = req.userId as number;
  await assertFixtureSubjectScope(pool, actorId, subjectId);
  return {
    actorId,
    subjectId,
    source: "admin",
    missing: () => new NotFoundError("User not found"),
  };
}

const usersWriter = routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_WRITE });

export function registerPhotoRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/me/photo",
    {
      config: routeAccess({ kind: "authenticated" }),
      preHandler: [requireAuth, requireIdempotencyKey],
      schema: {
        summary: "Upload my photo",
        description:
          "Multipart upload of the caller's account photo: PNG, JPEG or WebP (identified from the bytes, not the declared type), up to 2 MB. Stored privately under the caller's profile prefix and served only through GET /api/users/:id/photo; the previous photo object is deleted. Returns the new `image` route. Audited without the file. Accounts being removed (H54) are refused (#934).",
        response: { 200: photoResponse },
      },
    },
    async (req) => replacePhoto(req, ownChange(req)),
  );

  r.delete(
    "/api/me/photo",
    {
      config: routeAccess({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        summary: "Remove my photo",
        description:
          "Clears the caller's account photo and deletes its object. Removing when there is no photo changes nothing (#934).",
        response: { 200: photoResponse },
      },
    },
    async (req) => clearPhoto(req, ownChange(req)),
  );

  r.post(
    "/api/users/:id/photo",
    {
      config: usersWriter,
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), requireIdempotencyKey],
      schema: {
        params: photoParams,
        summary: "Upload a person's photo",
        description:
          "Staff replace someone's account photo from user management, with the same rules as POST /api/me/photo: PNG, JPEG or WebP identified from the bytes, up to 2 MB, stored privately under that person's profile prefix; the previous object is deleted. Returns the new `image` route. Audited as an admin change without the file. 404 for an unknown or out-of-scope account; accounts being removed (H54) answer 409 (#934, H8).",
        response: { 200: photoResponse },
      },
    },
    async (req) => replacePhoto(req, await staffChange(req, req.params.id)),
  );

  r.delete(
    "/api/users/:id/photo",
    {
      config: usersWriter,
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: photoParams,
        summary: "Remove a person's photo",
        description:
          "Staff clear someone's account photo from user management and delete its object, audited as an admin change. Removing when there is no photo changes nothing. 404 for an unknown or out-of-scope account; accounts being removed (H54) answer 409 (#934, H8).",
        response: { 200: photoResponse },
      },
    },
    async (req) => clearPhoto(req, await staffChange(req, req.params.id)),
  );

  r.get(
    "/api/users/:id/photo",
    {
      config: routeAccess({
        kind: "contextual",
        policy: "profile-photo-access",
        resource: { source: "params", field: "id" },
      }),
      preHandler: requireAuth,
      schema: {
        params: photoParams,
        summary: "Read a person's photo",
        description:
          "Streams an account photo after checking this request: the person themself, a user reader, or a directory reader (or an attendee who saved the person) with event access while the person is listed and shows the photo. Any other case, and a missing photo, answer 404. The `v` query parameter only versions the URL. Cached privately for 5 minutes (#934).",
      },
    },
    async (req, reply) => {
      const subjectId = req.params.id;
      if (!(await canSeePhoto(req, subjectId))) throw new NotFoundError("Photo not found");
      const { rows } = await pool.query<{ photo_key: string | null }>(
        `SELECT photo_key FROM users WHERE id = $1 AND anonymized_at IS NULL`,
        [subjectId],
      );
      const key = rows[0]?.photo_key;
      if (!key) throw new NotFoundError("Photo not found");
      return sendProfileObject(reply, key, {
        contentType: photoContentType(key),
        cacheControl: "private, max-age=300",
      });
    },
  );
}
