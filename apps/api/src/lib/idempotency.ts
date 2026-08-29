import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { ConflictError } from "./errors.js";

/**
 * Idempotency contract (plan/03 Fase 0; plan/07 §2). Critical mutations —
 * scanner flows (H22, H25, H26), queue transitions, spot confirmation —
 * accept an `Idempotency-Key` header. Same key + same request target/body replays
 * the stored response instead of re-executing; same key with a DIFFERENT
 * body is a 409; a concurrent in-flight duplicate is a 409 with retry hint.
 * A 5xx response is never replayed — it is a transient/server-side failure,
 * not a stable client-visible outcome, so the record is released instead
 * (see `idempotencyOnSend`) and the same key/body can retry immediately (#534).
 *
 * Usage: add `preHandler: idempotencyGuard` to the route and wrap the
 * handler result normally — the onSend hook persists the response.
 * Keys are scoped per (key, method+url, user); the request hash also includes
 * route parameters so target-bearing admin routes cannot cross-replay.
 */

/**
 * A "first execution" that never reaches `idempotencyOnSend` (dropped
 * connection, backgrounded app mid-request, server restart) would otherwise
 * leave `response_status` NULL forever — every retry with that key (mobile
 * scanners reuse the persisted scan id as the key, so this is exactly the
 * offline scan-queue replay path) then 409s as "still in flight" permanently,
 * jamming that scan and everything queued behind it (H22, H25, H26). Past
 * this age, a still-NULL row is treated as abandoned and reclaimed instead
 * of blocking forever.
 */
const STALE_IN_FLIGHT_MS = 30_000;

function requestHash(req: FastifyRequest): string {
  return (
    createHash("sha256")
      // Include the route parameters as well as the body.  An admin mutation
      // such as `/api/users/:id/anonymize` has an empty body, so hashing only the
      // body would allow the same key to be replayed for a different target.
      .update(
        JSON.stringify({
          method: req.method,
          url: req.routeOptions.url ?? req.url,
          params: req.params ?? null,
          body: req.body ?? null,
        }),
      )
      .digest("hex")
  );
}

declare module "fastify" {
  interface FastifyRequest {
    /** Optional route-specific scope for mutations whose target must be
     * scrubbed from the idempotency table after account removal. */
    idempotencyScope?: string;
    idempotency?: {
      key: string;
      scope: string;
      hash: string;
      replayed: boolean;
      /** H54: keep a pending self-removal marker across a 5xx. */
      preserveOnFailure?: boolean;
    };
  }
}

export async function idempotencyGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return; // header optional; without it the route runs normally

  const scope =
    req.idempotencyScope ??
    `${req.method} ${req.routeOptions.url ?? req.url} u:${req.userId ?? "anon"}`;
  const hash = requestHash(req);

  const inserted = await pool.query(
    `INSERT INTO idempotency_keys (key, scope, request_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (key, scope) DO NOTHING
     RETURNING key`,
    [key, scope, hash],
  );

  if (inserted.rowCount === 1) {
    req.idempotency = { key, scope, hash, replayed: false };
    return; // first execution; onSend hook stores the response
  }

  const existing = await pool.query(
    `SELECT request_hash, response_status, response_body, created_at FROM idempotency_keys
     WHERE key = $1 AND scope = $2`,
    [key, scope],
  );
  const row = existing.rows[0];
  if (!row) throw new ConflictError("Idempotency record vanished; retry");
  if (row.request_hash !== hash) {
    throw new ConflictError("Idempotency-Key reused with a different request target or body");
  }
  if (row.response_status === null) {
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > STALE_IN_FLIGHT_MS) {
      // Reclaim an abandoned first attempt. The UPDATE only affects a row
      // still NULL, so concurrent reclaim attempts have exactly one winner.
      const reclaimed = await pool.query(
        `UPDATE idempotency_keys SET created_at = now()
         WHERE key = $1 AND scope = $2 AND response_status IS NULL
         RETURNING key`,
        [key, scope],
      );
      if (reclaimed.rowCount === 1) {
        req.idempotency = { key, scope, hash, replayed: false };
        return;
      }
    }
    reply.header("retry-after", "1");
    throw new ConflictError("Duplicate request still in flight; retry shortly");
  }
  req.idempotency = { key, scope, hash, replayed: true };
  // Returning the sent reply is significant: merely calling send() from an
  // async pre-handler still lets Fastify continue to the route handler, which
  // would repeat side effects despite returning the stored response.
  return reply
    .code(row.response_status)
    .header("idempotency-replayed", "true")
    .send(row.response_body);
}

/**
 * Replays a completed, identity-free account-removal response before normal
 * authentication runs. Removal revokes every session as part of success, so a
 * client that lost the response cannot present the original session on a
 * retry. The caller must still possess the high-entropy idempotency key and
 * the exact request body; only the boolean completion response is stored in
 * this route-scoped record.
 */
export async function replayCompletedIdempotency(
  req: FastifyRequest,
  reply: FastifyReply,
  completionScope: string,
): Promise<boolean> {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return false;

  const { rows } = await pool.query<{
    request_hash: string;
    response_status: number | null;
    response_body: unknown;
  }>(
    `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
      WHERE key = $1 AND scope = $2`,
    [key, completionScope],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.request_hash !== requestHash(req)) {
    throw new ConflictError("Idempotency-Key reused with a different request target or body");
  }
  if (row.response_status === null) return false;
  reply.code(row.response_status).header("idempotency-replayed", "true").send(row.response_body);
  return true;
}

/** Registered globally in app.ts: persists responses for first executions. */
export async function idempotencyOnSend(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (req.idempotency && !req.idempotency.replayed) {
    if (reply.statusCode >= 500) {
      if (req.idempotency.preserveOnFailure) {
        // H54 is different from ordinary mutations: a storage/DB failure has
        // already committed removal_pending and revoked access. Keep a
        // NULL-response marker so a retry cannot lose the eventual
        // identity-free completion if the 503 response is dropped. The
        // normal stale-in-flight reclaim still permits a later retry.
        await pool.query(
          `UPDATE idempotency_keys
              SET response_body = NULL, completed_at = NULL, created_at = now()
            WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
          [req.idempotency.key, req.idempotency.scope],
        );
      } else {
        // A 5xx is a transient/server-side failure, not a stable client-visible
        // outcome (issue #534) — persisting it would replay the same error
        // forever, and mobile's offline scan queue reuses the scan id as the
        // key, so this is exactly the H22/H25/H26 recovery path. Release the
        // record instead so the same key/body can retry and actually
        // re-execute; guard on response_status IS NULL keeps exactly one
        // winner if a concurrent request is racing this same row.
        await pool.query(
          `DELETE FROM idempotency_keys WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
          [req.idempotency.key, req.idempotency.scope],
        );
      }
    } else {
      await pool.query(
        `UPDATE idempotency_keys SET response_status = $3, response_body = $4, completed_at = now()
         WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
        [req.idempotency.key, req.idempotency.scope, reply.statusCode, payload ?? null],
      );
    }
  }
  return payload;
}
