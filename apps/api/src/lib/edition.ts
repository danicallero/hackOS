import { EDITION_HEADER, EDITION_KEY_PATTERN, type EditionStatus } from "@hackos/shared/editions";
import type { FastifyRequest } from "fastify";
import type { Queryable } from "../db/pool.js";
import { BadRequestError, EditionClosedError, ForbiddenError, NotFoundError } from "./errors.js";
import { getRequestContext } from "./request-context.js";

/**
 * Multi-edition request scope (docs/multi-edition-plan.md, H8).
 *
 * The viewed edition travels per request as `X-Edition: <event_key>`; without
 * it the API acts on the current edition (`event_config.event_key`). Only an
 * explicit, non-current edition is stored on the AsyncLocalStorage request
 * context; `db/pool.ts` then sets the `hackos.edition` setting for the
 * statements of that request, so SQL reads it through `current_edition()`
 * and edition-scoped columns default to it. Requests on the current edition
 * (every client that never sends the header) pay nothing extra.
 */

/** Settings `db/pool.ts` applies to a connection before a request's statements. */
export interface EditionSessionSettings {
  edition: string | null;
  writeOverride: boolean;
}

/** The connection settings this async context needs, or null for the defaults. */
export function editionSessionSettings(): EditionSessionSettings | null {
  const ctx = getRequestContext();
  if (!ctx) return null;
  const edition = ctx.edition ?? null;
  const writeOverride = ctx.editionWriteOverride === true;
  if (edition === null && !writeOverride) return null;
  return { edition, writeOverride };
}

/** The explicit non-current edition of this request, if any (cache keys, logs). */
export function requestEditionOverride(): string | null {
  return getRequestContext()?.edition ?? null;
}

/**
 * Lets an explicitly authorized flow write into a closed edition: the
 * superadmin bypass and the close/reopen transaction itself. Scoped to the
 * current request/async context; the database trigger reads it per statement.
 */
export function allowClosedEditionWrites(): void {
  const ctx = getRequestContext();
  if (ctx) ctx.editionWriteOverride = true;
}

/** Run `fn` with closed-edition writes allowed (system flows: erasure, closing). */
export async function withClosedEditionWrites<T>(
  client: Queryable,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT set_config('hackos.edition_write_override', 'on', true)");
  return fn();
}

export interface EditionState {
  key: string;
  name: string;
  status: EditionStatus;
  isCurrent: boolean;
}

/** Edition the given connection is scoped to (`current_edition()`). */
export async function readScopedEdition(db: Queryable): Promise<EditionState | null> {
  const { rows } = await db.query<{
    event_key: string;
    name: string;
    status: EditionStatus;
    is_current: boolean;
  }>(
    `SELECT e.event_key, e.name, e.status,
            e.event_key = COALESCE((SELECT event_key FROM event_config WHERE id = 1), 'default') AS is_current
       FROM editions e WHERE e.event_key = current_edition()`,
  );
  const row = rows[0];
  return row
    ? { key: row.event_key, name: row.name, status: row.status, isCurrent: row.is_current }
    : null;
}

/**
 * Background workers act on the current edition and must not try to write
 * into it once it is closed (plan §3: workers ignore closed editions).
 */
export async function isScopedEditionClosed(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ closed: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM editions WHERE event_key = current_edition() AND status = 'closed') AS closed",
  );
  return rows[0]?.closed === true;
}

/** True when the user holds a protected global role (system:superadmin). */
export const GLOBAL_ADMIN_SQL = `EXISTS (
  SELECT 1 FROM user_roles gr JOIN roles grr ON grr.id = gr.role_id
   WHERE gr.user_id = $1 AND gr.event_key IS NULL AND grr.is_protected AND grr.deleted_at IS NULL)`;

/**
 * Resolve the `X-Edition` header after authentication (auth-context hook).
 * Anyone may scope to the current edition (someone without a role there is
 * an applicant). Another edition needs participation in it or the global
 * superadmin role; anonymous callers may read published (non-draft)
 * editions' public content.
 */
export async function applyRequestedEdition(req: FastifyRequest, db: Queryable): Promise<void> {
  const raw = req.headers[EDITION_HEADER];
  const requested = Array.isArray(raw) ? raw[0] : raw;
  if (requested === undefined || requested === "") return;
  if (!EDITION_KEY_PATTERN.test(requested)) {
    throw new BadRequestError("Invalid edition", { edition: requested });
  }
  const { rows } = await db.query<{
    status: EditionStatus;
    is_current: boolean;
    participated: boolean;
    global_admin: boolean;
  }>(
    `SELECT e.status,
            e.event_key = COALESCE((SELECT event_key FROM event_config WHERE id = 1), 'default') AS is_current,
            EXISTS (SELECT 1 FROM edition_participation p WHERE p.user_id = $1 AND p.event_key = e.event_key) AS participated,
            ${GLOBAL_ADMIN_SQL} AS global_admin
       FROM editions e WHERE e.event_key = $2`,
    [req.userId ?? 0, requested],
  );
  const edition = rows[0];
  if (!edition) throw new NotFoundError("Edition not found", { edition: requested });
  if (edition.is_current) return;
  if (!edition.global_admin) {
    if (edition.status === "draft") {
      throw new ForbiddenError("This edition is not available", { edition: requested });
    }
    if (req.userId != null && !edition.participated) {
      throw new ForbiddenError("You did not take part in this edition", { edition: requested });
    }
  }
  const ctx = getRequestContext();
  if (ctx) ctx.edition = requested;
}

/**
 * Shared closed-edition guard for mutating routes (plan §3). A route that
 * changes global data (account, profile, preferences, edition lifecycle)
 * declares `edition: "global"` in its access policy and skips it. A global
 * superadmin passes and gets the database override for this request.
 */
export async function assertEditionWritable(
  req: FastifyRequest,
  db: Queryable,
  options: { selfServiceAfterClose?: boolean } = {},
): Promise<void> {
  const { rows } = await db.query<{
    event_key: string;
    status: EditionStatus;
    global_admin: boolean;
  }>(
    `SELECT e.event_key, e.status, ${GLOBAL_ADMIN_SQL} AS global_admin
       FROM editions e WHERE e.event_key = current_edition()`,
    [req.userId ?? 0],
  );
  const edition = rows[0];
  if (edition?.status !== "closed") return;
  // Closing freezes what organizers administer; a participant's own
  // after-event record (a self-issued attendance certificate) stays possible.
  if (edition.global_admin || options.selfServiceAfterClose) {
    allowClosedEditionWrites();
    return;
  }
  throw new EditionClosedError(edition.event_key);
}

/** Map the database guard's SQLSTATE (migration 1001) to the business error. */
export function editionClosedFromDatabase(err: unknown): EditionClosedError | null {
  const e = err as { code?: string; detail?: string } | null;
  return e?.code === "HKE01" ? new EditionClosedError(e.detail ?? null) : null;
}
