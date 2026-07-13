import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { ConflictError } from "./errors.js";

/**
 * Idempotency contract (plan/03 Fase 0; plan/07 §2). Critical mutations —
 * scanner flows (H22, H25, H26), queue transitions, spot confirmation —
 * accept an `Idempotency-Key` header. Same key + same request body replays
 * the stored response instead of re-executing; same key with a DIFFERENT
 * body is a 409; a concurrent in-flight duplicate is a 409 with retry hint.
 *
 * Usage: add `preHandler: idempotencyGuard` to the route and wrap the
 * handler result normally — the onSend hook persists the response.
 * Keys are scoped per (key, method+url, user).
 */

function requestHash(req: FastifyRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(req.body ?? null))
    .digest("hex");
}

declare module "fastify" {
  interface FastifyRequest {
    idempotency?: { key: string; scope: string; hash: string; replayed: boolean };
  }
}

export async function idempotencyGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") return; // header optional; without it the route runs normally

  const scope = `${req.method} ${req.routeOptions.url ?? req.url} u:${req.userId ?? "anon"}`;
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
    `SELECT request_hash, response_status, response_body FROM idempotency_keys
     WHERE key = $1 AND scope = $2`,
    [key, scope],
  );
  const row = existing.rows[0];
  if (!row) throw new ConflictError("Idempotency record vanished; retry");
  if (row.request_hash !== hash) {
    throw new ConflictError("Idempotency-Key reused with a different request body");
  }
  if (row.response_status === null) {
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

/** Registered globally in app.ts: persists responses for first executions. */
export async function idempotencyOnSend(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  if (req.idempotency && !req.idempotency.replayed) {
    await pool.query(
      `UPDATE idempotency_keys SET response_status = $3, response_body = $4, completed_at = now()
       WHERE key = $1 AND scope = $2`,
      [req.idempotency.key, req.idempotency.scope, reply.statusCode, payload ?? null],
    );
  }
  return payload;
}
