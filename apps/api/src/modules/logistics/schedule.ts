import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";

export interface ScheduleInput {
  title: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  startsAt: Date;
  endsAt: Date;
  visibility: "shown" | "hidden";
  publishAt?: Date | null;
}

export interface SchedulePatch {
  title?: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  visibility?: "shown" | "hidden";
  publishAt?: Date | null;
}

function serialize(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    type: (row.type as string | null) ?? null,
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    visibility: String(row.visibility),
    publishAt: row.publish_at instanceof Date ? row.publish_at.toISOString() : null,
    remindedAt: row.reminded_at instanceof Date ? row.reminded_at.toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

function assertWindow(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestError("endsAt must be after startsAt");
  }
}

async function emitScheduleChanged(data: unknown) {
  await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_SCHEDULE_CHANGED, data);
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.CONTENT_SCHEDULE_CHANGED, data);
}

export async function listSchedule() {
  const { rows } = await pool.query(
    `SELECT id, title, description, location, type, starts_at, ends_at, visibility,
            publish_at, reminded_at, created_at, updated_at
       FROM schedule
      ORDER BY starts_at ASC, id ASC`,
  );
  return { items: rows.map(serialize) };
}

export async function createScheduleItem(actorId: number | null, input: ScheduleInput) {
  assertWindow(input.startsAt, input.endsAt);
  const item = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO schedule
         (title, description, location, type, starts_at, ends_at, visibility, publish_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, location, type, starts_at, ends_at, visibility,
                 publish_at, reminded_at, created_at, updated_at`,
      [
        input.title,
        input.description ?? null,
        input.location ?? null,
        input.type ?? null,
        input.startsAt,
        input.endsAt,
        input.visibility,
        input.publishAt ?? null,
      ],
    );
    const item = serialize(rows[0]);
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: item.id,
      action: "create",
      after: item,
    });
    return item;
  });
  await emitScheduleChanged({ action: "create", item });
  return item;
}

export async function updateScheduleItem(actorId: number | null, id: number, patch: SchedulePatch) {
  const item = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, title, description, location, type, starts_at, ends_at, visibility,
              publish_at, reminded_at, created_at, updated_at
         FROM schedule WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0]) throw new NotFoundError("Schedule item not found", { id });
    const before = serialize(current.rows[0]);
    const nextStartsAt = patch.startsAt ?? (current.rows[0].starts_at as Date);
    const nextEndsAt = patch.endsAt ?? (current.rows[0].ends_at as Date);
    assertWindow(nextStartsAt, nextEndsAt);

    const { rows } = await client.query(
      `UPDATE schedule
          SET title = $2,
              description = $3,
              location = $4,
              type = $5,
              starts_at = $6,
              ends_at = $7,
              visibility = $8,
              publish_at = $9
        WHERE id = $1
        RETURNING id, title, description, location, type, starts_at, ends_at, visibility,
                  publish_at, reminded_at, created_at, updated_at`,
      [
        id,
        patch.title ?? current.rows[0].title,
        patch.description === undefined ? current.rows[0].description : patch.description,
        patch.location === undefined ? current.rows[0].location : patch.location,
        patch.type === undefined ? current.rows[0].type : patch.type,
        nextStartsAt,
        nextEndsAt,
        patch.visibility ?? current.rows[0].visibility,
        patch.publishAt === undefined ? current.rows[0].publish_at : patch.publishAt,
      ],
    );
    const after = serialize(rows[0]);
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return after;
  });
  await emitScheduleChanged({ action: "update", item });
  return item;
}

export async function deleteScheduleItem(actorId: number | null, id: number) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM schedule
        WHERE id = $1
        RETURNING id, title, description, location, type, starts_at, ends_at, visibility,
                  publish_at, reminded_at, created_at, updated_at`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError("Schedule item not found", { id });
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: id,
      action: "delete",
      before: serialize(rows[0]),
    });
  });
  await emitScheduleChanged({ action: "delete", id });
  return { deleted: true as const };
}

export async function setScheduleVisibility(
  actorId: number | null,
  ids: number[],
  visibility: "shown" | "hidden",
) {
  const result = await withTransaction(async (client) => {
    const before = await client.query(
      `SELECT id, visibility FROM schedule WHERE id = ANY($1::int[]) FOR UPDATE`,
      [ids],
    );
    const { rows } = await client.query(
      `UPDATE schedule SET visibility = $2 WHERE id = ANY($1::int[]) RETURNING id`,
      [ids, visibility],
    );
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: `batch:${visibility}`,
      action: "set_visibility",
      before: { rows: before.rows },
      after: { ids, visibility, updated: rows.length },
    });
    return { ids: rows.map((r: { id: number }) => r.id), visibility, updated: rows.length };
  });
  await emitScheduleChanged({ action: "set_visibility", ...result });
  return result;
}
