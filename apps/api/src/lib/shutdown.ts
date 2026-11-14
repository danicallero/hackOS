import type { FastifyInstance } from "fastify";
import { closeAllSseStreams } from "./sse.js";

/**
 * Graceful drain for a replica leaving a rolling deployment (#1327).
 *
 * The deploy relay (deploy/README.md § Despliegue sin corte) sends new
 * connections to whichever replica is listening, and retries a connection
 * that is refused. Draining therefore:
 *
 * 1. reports `/readyz` as 503 and adds `Connection: close` to every response,
 *    so the relay's pooled keep-alive connections end after their current
 *    request instead of carrying new ones to this replica;
 * 2. stops listening, so new connections go to the remaining replica;
 * 3. lets in-flight requests finish, sweeping connections as they go idle;
 * 4. ends SSE streams spread over a short window, so clients reconnect and
 *    refetch against the remaining replica without a synchronized burst;
 * 5. force-closes whatever is still open once the drain deadline passes.
 *
 * Committed writes are already durable in PostgreSQL; an interrupted request
 * is one the client never saw succeed, and critical mutations retry safely
 * through their Idempotency-Key (lib/idempotency.ts).
 */

let draining = false;

export function isDraining(): boolean {
  return draining;
}

export function registerDrainHooks(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    if (draining) reply.header("connection", "close");
    return payload;
  });
}

const IDLE_SWEEP_INTERVAL_MS = 250;

export async function drainAndClose(
  app: FastifyInstance,
  options: { drainTimeoutMs: number; sseSpreadMs: number },
): Promise<void> {
  draining = true;
  const closed = app.close();
  // Fastify closes idle sockets once; responses that finish later leave
  // their keep-alive socket idle and would otherwise hold close() open.
  const sweep = setInterval(() => app.server.closeIdleConnections(), IDLE_SWEEP_INTERVAL_MS);
  const deadline = setTimeout(() => app.server.closeAllConnections(), options.drainTimeoutMs);
  try {
    await Promise.all([closed, closeAllSseStreams(options.sseSpreadMs)]);
  } finally {
    clearInterval(sweep);
    clearTimeout(deadline);
  }
}
