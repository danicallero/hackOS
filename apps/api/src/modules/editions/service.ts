import type { EditionStatus, EditionSummary, MyEditionsResponse } from "@hackos/shared/editions";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type pg from "pg";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { GLOBAL_ADMIN_SQL } from "../../lib/edition.js";
import { ConflictError, EditionClosedError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";

/**
 * Edition lifecycle (docs/multi-edition-plan.md §3-§4, H53 audit).
 *
 *   draft --activate--> active --close--> closed --reopen--> active
 *
 * `event_config` keeps the live settings of the current edition; activating
 * another edition snapshots them on the previous edition and restores saved
 * windows and onboarding, or starts a new edition with empty values. People's data is never
 * copied. Closing is one transaction: project drafts become not_submitted,
 * pending queue entries are cancelled (not evaluated), open/claimed help
 * requests are cancelled, help windows end and judging sessions end — with
 * no notification of any kind. Reopening only restores the ability to edit.
 */

interface EditionRow {
  event_key: string;
  name: string;
  status: EditionStatus;
  starts_at: Date | null;
  ends_at: Date | null;
  is_current: boolean;
}

const EDITION_COLUMNS = `e.event_key, e.name, e.status, e.starts_at, e.ends_at,
  e.event_key = COALESCE((SELECT event_key FROM event_config WHERE id = 1), 'default') AS is_current`;

function toSummary(row: EditionRow): EditionSummary {
  return {
    eventKey: row.event_key,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
    isCurrent: row.is_current,
  };
}

const NEWEST_FIRST = "ORDER BY e.starts_at DESC NULLS LAST, e.created_at DESC, e.event_key";

/** Every edition, for the organizers' edition management (event:manage). */
export async function listEditions(db: Queryable = pool): Promise<EditionSummary[]> {
  const { rows } = await db.query<EditionRow>(
    `SELECT ${EDITION_COLUMNS} FROM editions e ${NEWEST_FIRST}`,
  );
  return rows.map(toSummary);
}

/**
 * Editions the user may view: the current one (someone without a role there
 * is an applicant), every published edition they took part in (roles,
 * applications, enterprise membership) and, for the global superadmin, all.
 */
export async function myEditions(userId: number): Promise<MyEditionsResponse> {
  const { rows } = await pool.query<EditionRow>(
    `SELECT ${EDITION_COLUMNS}
       FROM editions e
      WHERE e.event_key = COALESCE((SELECT event_key FROM event_config WHERE id = 1), 'default')
         OR ${GLOBAL_ADMIN_SQL}
         OR (e.status <> 'draft' AND EXISTS (
              SELECT 1 FROM edition_participation p WHERE p.user_id = $1 AND p.event_key = e.event_key))
      ${NEWEST_FIRST}`,
    [userId],
  );
  const editions = rows.map(toSummary);
  const current = editions.find((edition) => edition.isCurrent)?.eventKey ?? "default";
  return { current, editions };
}

async function lockEdition(client: pg.PoolClient, eventKey: string): Promise<EditionRow> {
  const { rows } = await client.query<EditionRow>(
    `SELECT ${EDITION_COLUMNS} FROM editions e WHERE e.event_key = $1 FOR UPDATE`,
    [eventKey],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("Edition not found", { edition: eventKey });
  return row;
}

async function readEdition(client: Queryable, eventKey: string): Promise<EditionSummary> {
  const { rows } = await client.query<EditionRow>(
    `SELECT ${EDITION_COLUMNS} FROM editions e WHERE e.event_key = $1`,
    [eventKey],
  );
  return toSummary(rows[0] as EditionRow);
}

function announce(edition: EditionSummary): Promise<unknown> {
  // Session facts (capabilities, read-only state) change for everyone viewing it.
  return Promise.all([
    broadcast(SSE_TOPICS.IDENTITY, EVENTS.EDITION_CHANGED, {
      eventKey: edition.eventKey,
      status: edition.status,
    }),
    broadcast(SSE_TOPICS.IDENTITY, EVENTS.DOMAIN_CHANGED, {}),
  ]).catch(() => undefined);
}

export interface EditionInput {
  eventKey: string;
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Create a draft edition. Nothing is copied: enterprises, stands, challenges start empty. */
export async function createEdition(actorId: number, input: EditionInput): Promise<EditionSummary> {
  const created = await withTransaction(async (client) => {
    const { rows } = await client.query<{ event_key: string }>(
      `INSERT INTO editions (event_key, name, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'draft')
       ON CONFLICT (event_key) DO NOTHING
       RETURNING event_key`,
      [input.eventKey, input.name.trim(), input.startsAt ?? null, input.endsAt ?? null],
    );
    if (!rows[0]) {
      throw new ConflictError("An edition with this key already exists", {
        edition: input.eventKey,
      });
    }
    const edition = await readEdition(client, input.eventKey);
    await audit(client, {
      actorId,
      entityType: "edition",
      entityId: input.eventKey,
      action: "created",
      after: edition,
    });
    return edition;
  });
  await announce(created);
  return created;
}

export interface EditionPatch {
  name?: string;
  startsAt?: string | null;
  endsAt?: string | null;
}

/**
 * Rename or re-date an edition. The current edition's name and dates live in
 * event_config (event settings) and are mirrored to the catalogue by trigger.
 */
export async function updateEdition(
  actorId: number,
  eventKey: string,
  patch: EditionPatch,
): Promise<EditionSummary> {
  return withTransaction(async (client) => {
    const before = await lockEdition(client, eventKey);
    if (before.status === "closed") throw new EditionClosedError(eventKey);
    const name = patch.name?.trim() ?? before.name;
    const startsAt = patch.startsAt !== undefined ? patch.startsAt : before.starts_at;
    const endsAt = patch.endsAt !== undefined ? patch.endsAt : before.ends_at;
    if (before.is_current) {
      await client.query(
        "UPDATE event_config SET name = $1, event_starts_at = $2, event_ends_at = $3 WHERE id = 1",
        [name, startsAt, endsAt],
      );
    } else {
      await client.query(
        "UPDATE editions SET name = $2, starts_at = $3, ends_at = $4 WHERE event_key = $1",
        [eventKey, name, startsAt, endsAt],
      );
    }
    const after = await readEdition(client, eventKey);
    await audit(client, {
      actorId,
      entityType: "edition",
      entityId: eventKey,
      action: "updated",
      changedFields: Object.keys(patch),
      before: toSummary(before),
      after,
    });
    return after;
  });
}

/**
 * Make `eventKey` the current edition inside an open transaction (also used
 * by the legacy `eventKey` field of PUT /api/event). Idempotent.
 */
export async function activateEditionInTransaction(
  client: pg.PoolClient,
  actorId: number | null,
  eventKey: string,
): Promise<{ edition: EditionSummary; changed: boolean }> {
  const target = await lockEdition(client, eventKey);
  if (target.status === "closed") {
    throw new ConflictError("Reopen this edition before making it the current one", {
      edition: eventKey,
    });
  }
  const { rows: configRows } = await client.query<{ event_key: string }>(
    "SELECT event_key FROM event_config WHERE id = 1 FOR UPDATE",
  );
  const previous = configRows[0]?.event_key ?? null;
  if (previous === eventKey && target.status === "active") {
    return { edition: toSummary(target), changed: false };
  }
  await client.query("UPDATE editions SET status = 'active' WHERE event_key = $1", [eventKey]);
  if (previous !== null && previous !== eventKey) {
    // History only: the Wi-Fi password is a credential and is not kept.
    await client.query(
      `UPDATE editions
          SET settings_snapshot = (SELECT to_jsonb(ec) - 'wifi_password' FROM event_config ec WHERE ec.id = 1)
        WHERE event_key = $1`,
      [previous],
    );
    // H53: restore returning editions; only new editions start with empty timing and onboarding
    // (RSVP settings and forms are keyed by edition already).
    await client.query(
      `UPDATE event_config
          SET event_key = $1, name = $2, event_starts_at = $3, event_ends_at = $4,
              hacking_starts_at = saved.hacking_starts_at, hacking_ends_at = saved.hacking_ends_at,
              show_start_countdown = COALESCE(saved.show_start_countdown, false),
              presence_auto_entry_at = saved.presence_auto_entry_at,
              project_drafts_open_at = saved.project_drafts_open_at,
              project_submissions_close_at = saved.project_submissions_close_at,
              project_gallery_opens_at = saved.project_gallery_opens_at,
              onboarding_config = COALESCE(saved.onboarding_config, '{}'::jsonb),
              onboarding_revision = event_config.onboarding_revision + 1
         FROM editions e
         CROSS JOIN LATERAL jsonb_populate_record(NULL::event_config, e.settings_snapshot) saved
        WHERE event_config.id = 1 AND e.event_key = $1`,
      [eventKey, target.name, target.starts_at, target.ends_at],
    );
    // The previous edition's pending pre-event email belongs to that event.
    await client.query(
      "UPDATE event_email_reminders SET status = 'cancelled' WHERE status = 'scheduled'",
    );
  }
  const edition = await readEdition(client, eventKey);
  await audit(client, {
    actorId,
    entityType: "edition",
    entityId: eventKey,
    action: "activated",
    before: { current: previous, status: target.status },
    after: edition,
  });
  return { edition, changed: true };
}

export async function activateEdition(actorId: number, eventKey: string): Promise<EditionSummary> {
  const { edition, changed } = await withTransaction((client) =>
    activateEditionInTransaction(client, actorId, eventKey),
  );
  if (changed) await announce(edition);
  return edition;
}

export interface ClosingEffects {
  projectsNotSubmitted: number;
  queueEntriesCancelled: number;
  judgingSessionsEnded: number;
  roomsPaused: number;
  helpRequestsCancelled: number;
  helpWindowsClosed: number;
  helperAvailabilityClosed: number;
}

/**
 * Close an edition: it becomes read-only and its live processes stop. All
 * effects run in one transaction before the status flips, so the edition
 * write guard still allows them; none of them enqueues a notification.
 * Idempotent: closing a closed edition changes nothing.
 */
export async function closeEdition(
  actorId: number,
  eventKey: string,
): Promise<{ edition: EditionSummary; effects: ClosingEffects | null }> {
  const result = await withTransaction(async (client) => {
    const target = await lockEdition(client, eventKey);
    if (target.status === "closed") return { edition: toSummary(target), effects: null };
    if (target.status === "draft") {
      throw new ConflictError("A draft edition has nothing to close", { edition: eventKey });
    }
    const effects = await applyClosingEffects(client, actorId, eventKey);
    await client.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = $1",
      [eventKey],
    );
    const edition = await readEdition(client, eventKey);
    await audit(client, {
      actorId,
      entityType: "edition",
      entityId: eventKey,
      action: "closed",
      before: { status: target.status },
      after: { ...edition, effects },
    });
    return { edition, effects };
  });
  if (result.effects) await announce(result.edition);
  return result;
}

async function applyClosingEffects(
  client: pg.PoolClient,
  actorId: number,
  eventKey: string,
): Promise<ClosingEffects> {
  // H20: drafts that were never submitted stay as not submitted.
  const projects = await client.query(
    `UPDATE repos SET submission_status = 'not_submitted'
      WHERE event_key = $1 AND submission_status = 'draft'`,
    [eventKey],
  );
  // H29-H40: pending teams are not evaluated (the same terminal state a queue
  // clear uses); one history row per entry, no team notification.
  const queue = await client.query<{ id: number; previous: string }>(
    `WITH pending AS (
       SELECT id, status::text AS previous FROM queue_entries
        WHERE event_key = $1
          AND status IN ('waiting', 'called', 'returned_to_queue', 'in_room', 'presenting')
        FOR UPDATE
     ), updated AS (
       UPDATE queue_entries qe
          SET status = 'cancelled', assigned_room_id = NULL, called_at = NULL, precalled_at = NULL
         FROM pending p WHERE qe.id = p.id
       RETURNING qe.id
     )
     SELECT p.id, p.previous FROM pending p JOIN updated u ON u.id = p.id`,
    [eventKey],
  );
  if (queue.rows.length > 0) {
    await client.query(
      `INSERT INTO queue_history (queue_entry_id, actor_id, previous_status, new_status, action, reason)
       SELECT id, $2, previous, 'cancelled', 'edition_close', 'Edition closed'
         FROM unnest($1::int[], $3::text[]) AS t(id, previous)`,
      [queue.rows.map((row) => row.id), actorId, queue.rows.map((row) => row.previous)],
    );
  }
  const sessions = await client.query(
    `UPDATE judging_session js SET ended_at = now()
       FROM queue_entries qe
      WHERE qe.id = js.queue_entry_id AND qe.event_key = $1 AND js.ended_at IS NULL`,
    [eventKey],
  );
  await client.query(
    `DELETE FROM judging_field_leases l USING queue_entries qe
      WHERE qe.id = l.queue_entry_id AND qe.event_key = $1`,
    [eventKey],
  );
  const rooms = await client.query(
    `UPDATE room_queue_state rqs SET is_paused = true
       FROM rooms r WHERE r.id = rqs.room_id AND r.event_key = $1 AND NOT rqs.is_paused`,
    [eventKey],
  );
  await client.query("UPDATE rooms SET status = 'paused' WHERE event_key = $1", [eventKey]);
  // H64-H66: the event is over; open and claimed requests will not be served.
  const requests = await client.query(
    `UPDATE help_requests SET status = 'cancelled', cancelled_at = now()
      WHERE event_key = $1 AND status IN ('open', 'claimed')`,
    [eventKey],
  );
  // H62/H67: help windows and helper availability end now; future ones go.
  const windowsEnded = await client.query(
    `UPDATE helpdesk_open_windows SET ends_at = now()
      WHERE event_key = $1 AND starts_at < now() AND ends_at > now()`,
    [eventKey],
  );
  const windowsDropped = await client.query(
    "DELETE FROM helpdesk_open_windows WHERE event_key = $1 AND starts_at >= now()",
    [eventKey],
  );
  const availabilityEnded = await client.query(
    `UPDATE helper_availability SET ends_at = now()
      WHERE event_key = $1 AND starts_at < now() AND ends_at > now()`,
    [eventKey],
  );
  const availabilityDropped = await client.query(
    "DELETE FROM helper_availability WHERE event_key = $1 AND starts_at >= now()",
    [eventKey],
  );
  return {
    projectsNotSubmitted: projects.rowCount ?? 0,
    queueEntriesCancelled: queue.rows.length,
    judgingSessionsEnded: sessions.rowCount ?? 0,
    roomsPaused: rooms.rowCount ?? 0,
    helpRequestsCancelled: requests.rowCount ?? 0,
    helpWindowsClosed: (windowsEnded.rowCount ?? 0) + (windowsDropped.rowCount ?? 0),
    helperAvailabilityClosed:
      (availabilityEnded.rowCount ?? 0) + (availabilityDropped.rowCount ?? 0),
  };
}

/**
 * Reopen a closed edition: only the ability to edit returns. Final states of
 * queues, submissions and help requests stay, and nothing is re-notified.
 */
export async function reopenEdition(actorId: number, eventKey: string): Promise<EditionSummary> {
  const result = await withTransaction(async (client) => {
    const target = await lockEdition(client, eventKey);
    if (target.status !== "closed") return { edition: toSummary(target), changed: false };
    await client.query(
      "UPDATE editions SET status = 'active', closed_at = NULL WHERE event_key = $1",
      [eventKey],
    );
    const edition = await readEdition(client, eventKey);
    await audit(client, {
      actorId,
      entityType: "edition",
      entityId: eventKey,
      action: "reopened",
      before: { status: "closed" },
      after: edition,
    });
    return { edition, changed: true };
  });
  if (result.changed) await announce(result.edition);
  return result.edition;
}

/**
 * The first rename of the legacy 'default' key adopts it (0803 semantics):
 * the key cascades to every edition-scoped row. Any later key change opens or
 * activates that edition and leaves the previous one intact.
 */
export async function changeCurrentEditionKey(
  client: pg.PoolClient,
  actorId: number | null,
  currentKey: string,
  nextKey: string,
): Promise<void> {
  if (currentKey === nextKey) return;
  if (currentKey === "default") {
    const taken = await client.query("SELECT 1 FROM editions WHERE event_key = $1", [nextKey]);
    if (taken.rowCount === 0) {
      await client.query("UPDATE editions SET event_key = $1 WHERE event_key = 'default'", [
        nextKey,
      ]);
      await audit(client, {
        actorId,
        entityType: "edition",
        entityId: nextKey,
        action: "adopted",
        before: { eventKey: "default" },
        after: { eventKey: nextKey },
      });
      return;
    }
  }
  await client.query(
    `INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'draft')
     ON CONFLICT (event_key) DO NOTHING`,
    [nextKey],
  );
  await activateEditionInTransaction(client, actorId, nextKey);
}
