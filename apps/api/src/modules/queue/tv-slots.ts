import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { publishTvState, type TvSlot, type TvSlotItem } from "./tv.js";

/**
 * H42 timetable CRUD. Editing a slot can change what the screens show *right
 * now* (you can edit the running slot), so every mutation re-resolves and
 * republishes the effective state instead of waiting up to 5s for the
 * scheduler tick. Mutations are audited (H53) inside the same transaction as
 * the write.
 */

export interface TvSlotInput {
  label?: string | null;
  startsAt: string;
  endsAt: string;
  items: Array<{ mode: TvSlotItem["mode"]; payload?: unknown; seconds?: number | null }>;
}

const SELECT = `SELECT id, label, starts_at, ends_at, items FROM tv_slots`;

function rowToSlot(row: Record<string, unknown>): TvSlot {
  return {
    id: Number(row.id),
    label: (row.label as string | null) ?? null,
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    items: row.items as TvSlotItem[],
  };
}

function normalizeItems(items: TvSlotInput["items"]): TvSlotItem[] {
  return items.map((item) => ({
    mode: item.mode,
    payload: item.payload ?? null,
    seconds: item.seconds ?? null,
  }));
}

/** The DB CHECK would catch this too, but as a 500 rather than a usable message. */
function assertWindow(startsAt: string, endsAt: string): void {
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new BadRequestError("A slot must end after it starts");
  }
}

export async function createTvSlot(input: TvSlotInput, actorId: number | null): Promise<TvSlot> {
  assertWindow(input.startsAt, input.endsAt);
  const slot = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tv_slots (label, starts_at, ends_at, items)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, label, starts_at, ends_at, items`,
      [
        input.label ?? null,
        input.startsAt,
        input.endsAt,
        JSON.stringify(normalizeItems(input.items)),
      ],
    );
    const created = rowToSlot(rows[0]);
    await audit(client, {
      actorId,
      entityType: "tv_slot",
      entityId: created.id,
      action: "create",
      after: created,
    });
    return created;
  });
  await afterTimetableChange();
  return slot;
}

export async function updateTvSlot(
  id: number,
  input: Partial<TvSlotInput>,
  actorId: number | null,
): Promise<TvSlot> {
  const slot = await withTransaction(async (client) => {
    // FOR UPDATE so two operators dragging the same slot can't interleave a
    // read-modify-write and lose one of the edits.
    const { rows: existingRows } = await client.query(`${SELECT} WHERE id = $1 FOR UPDATE`, [id]);
    if (!existingRows[0]) throw new NotFoundError("TV slot not found");
    const before = rowToSlot(existingRows[0]);

    const next = {
      label: input.label === undefined ? before.label : input.label,
      startsAt: input.startsAt ?? before.startsAt,
      endsAt: input.endsAt ?? before.endsAt,
      items: input.items ? normalizeItems(input.items) : before.items,
    };
    assertWindow(next.startsAt, next.endsAt);

    const { rows } = await client.query(
      `UPDATE tv_slots SET label = $2, starts_at = $3, ends_at = $4, items = $5::jsonb
        WHERE id = $1
        RETURNING id, label, starts_at, ends_at, items`,
      [id, next.label, next.startsAt, next.endsAt, JSON.stringify(next.items)],
    );
    const updated = rowToSlot(rows[0]);
    await audit(client, {
      actorId,
      entityType: "tv_slot",
      entityId: id,
      action: "update",
      before,
      after: updated,
    });
    return updated;
  });
  await afterTimetableChange();
  return slot;
}

export async function deleteTvSlot(id: number, actorId: number | null): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(`DELETE FROM tv_slots WHERE id = $1 RETURNING *`, [id]);
    if (!rows[0]) throw new NotFoundError("TV slot not found");
    await audit(client, {
      actorId,
      entityType: "tv_slot",
      entityId: id,
      action: "delete",
      before: rowToSlot(rows[0]),
    });
  });
  await afterTimetableChange();
}

/**
 * Control panels refresh their timetable on TV_SCHEDULE_CHANGED; screens react
 * to the republished mode. Both go out on the TV topic the fleet already
 * listens on.
 */
async function afterTimetableChange(): Promise<void> {
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_SCHEDULE_CHANGED, {});
  await publishTvState();
}
