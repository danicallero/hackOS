import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { AvailabilityInterval, HelpdeskSchedule } from "@hackos/shared/help-desk";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError } from "../../lib/errors.js";
import { suggestedAvailability } from "./helpers.js";
import type { ScheduleInput } from "./schemas.js";

// H64: the windows in which the help desk accepts NEW requests. No rows means
// always open. Only creating a request is gated (see `assertHelpdeskOpen`).

/** Serializes concurrent replacements of the whole set. */
const SCHEDULE_LOCK = 640_001;

interface Row {
  starts_at: Date;
  ends_at: Date;
}

async function readWindows(db: Queryable): Promise<{ rows: Row[]; now: Date }> {
  const [{ rows }, clock] = await Promise.all([
    db.query<Row>("SELECT starts_at, ends_at FROM helpdesk_open_windows ORDER BY starts_at, id"),
    db.query<{ now: Date }>("SELECT now() AS now"),
  ]);
  return { rows, now: (clock.rows[0] as { now: Date }).now };
}

function isOpen(rows: Row[], now: Date): boolean {
  return rows.length === 0 || rows.some((r) => r.starts_at <= now && now < r.ends_at);
}

/** The next instant `open` flips; touching windows count as one continuous opening. */
function nextChange(rows: Row[], now: Date): Date | null {
  if (rows.length === 0) return null;
  const current = rows.find((r) => r.starts_at <= now && now < r.ends_at);
  if (!current) return rows.find((r) => r.starts_at > now)?.starts_at ?? null;
  let end = current.ends_at;
  for (const r of rows) if (r.starts_at <= end && r.ends_at > end) end = r.ends_at;
  return end;
}

/** Whether requests are limited to people with event access (default: yes). */
export async function eventAccessOnly(db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query<{ only: boolean }>(
    "SELECT helpdesk_event_access_only AS only FROM event_config WHERE id = 1",
  );
  return rows[0]?.only ?? true;
}

export async function getSchedule(db: Queryable = pool): Promise<HelpdeskSchedule> {
  const [{ rows, now }, suggestedInterval, accessOnly] = await Promise.all([
    readWindows(db),
    suggestedAvailability(db),
    eventAccessOnly(db),
  ]);
  const windows: AvailabilityInterval[] = rows.map((r) => ({
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
  }));
  return {
    eventAccessOnly: accessOnly,
    configured: rows.length > 0,
    open: isOpen(rows, now),
    windows,
    nextChangeAt: nextChange(rows, now)?.toISOString() ?? null,
    suggestedInterval,
  };
}

/** Throws 409 `helpdesk_closed` when windows exist and now is outside all of them. */
export async function assertHelpdeskOpen(db: Queryable): Promise<void> {
  const { rows, now } = await readWindows(db);
  if (!isOpen(rows, now)) {
    throw new ConflictError("The help desk is closed right now", {
      code: ERROR_REASONS.HELPDESK_CLOSED,
      nextChangeAt: nextChange(rows, now)?.toISOString() ?? null,
    });
  }
}

/** Complete replacement; an empty list clears the schedule (always open). */
export async function replaceSchedule(
  actorId: number,
  input: ScheduleInput,
): Promise<{ changed: boolean; schedule: HelpdeskSchedule }> {
  const windows = input.windows
    .map((w) => ({ startsAt: new Date(w.startsAt), endsAt: new Date(w.endsAt) }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const [index, w] of windows.entries()) {
    if (w.endsAt <= w.startsAt) {
      throw new BadRequestError("Each window must end after it starts");
    }
    const previous = windows[index - 1];
    if (previous && previous.endsAt > w.startsAt) {
      throw new BadRequestError("Opening windows must not overlap");
    }
  }
  const changed = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEDULE_LOCK]);
    const { rows, now } = await readWindows(client);
    const key = (list: { startsAt: Date; endsAt: Date }[]) =>
      list.map((i) => `${i.startsAt.toISOString()}/${i.endsAt.toISOString()}`).join(",");
    const before = rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at }));
    const accessBefore = await eventAccessOnly(client);
    const accessAfter = input.eventAccessOnly ?? accessBefore;
    const accessChanged = accessAfter !== accessBefore;
    if (key(before) === key(windows) && !accessChanged) return false;
    if (accessChanged) {
      await client.query(
        `INSERT INTO event_config (id, helpdesk_event_access_only) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET helpdesk_event_access_only = EXCLUDED.helpdesk_event_access_only`,
        [accessAfter],
      );
    }
    await client.query("DELETE FROM helpdesk_open_windows");
    if (windows.length > 0) {
      await client.query(
        `INSERT INTO helpdesk_open_windows (starts_at, ends_at)
         SELECT s, e FROM unnest($1::timestamptz[], $2::timestamptz[]) AS x(s, e)`,
        [windows.map((w) => w.startsAt), windows.map((w) => w.endsAt)],
      );
    }
    const openBefore = isOpen(rows, now);
    const openAfter = isOpen(
      windows.map((w) => ({ starts_at: w.startsAt, ends_at: w.endsAt })),
      now,
    );
    await audit(client, {
      actorId,
      entityType: "helpdesk_schedule",
      entityId: 1,
      action: "replaced",
      changedFields: [
        ...(key(before) !== key(windows) ? ["windows"] : []),
        ...(accessChanged ? ["eventAccessOnly"] : []),
        ...((before.length === 0) !== (windows.length === 0) ? ["configured"] : []),
        ...(openBefore !== openAfter ? ["open"] : []),
      ],
      before: {
        windows: before.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })),
        eventAccessOnly: accessBefore,
        configured: before.length > 0,
        open: openBefore,
      },
      after: {
        windows: windows.map((w) => ({ startsAt: w.startsAt, endsAt: w.endsAt })),
        eventAccessOnly: accessAfter,
        configured: windows.length > 0,
        open: openAfter,
      },
    });
    return true;
  });
  return { changed, schedule: await getSchedule() };
}
