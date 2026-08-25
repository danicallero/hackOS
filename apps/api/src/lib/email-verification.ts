import type { FastifyRequest } from "fastify";
import type { Queryable } from "../db/pool.js";
import { pool } from "../db/pool.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors.js";

/** H1: primary-email verification is the boundary for event transactions. */
export async function assertVerifiedPrimaryEmail(
  db: Queryable,
  userId: number,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<void> {
  const { rows } = await db.query(
    `SELECT email_verified FROM users WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found", { userId });
  if (!rows[0].email_verified) {
    throw new ForbiddenError("Verify your email before performing this action", {
      code: "email_not_verified",
    });
  }
}

/** Shared caller guard used by the route-policy infrastructure (H1). */
export async function requireVerifiedEmail(request: FastifyRequest): Promise<void> {
  if (request.userId == null) throw new UnauthorizedError();
  await assertVerifiedPrimaryEmail(pool, request.userId);
}
