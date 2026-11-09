import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import type { HelpTopic } from "./helpers.js";

/**
 * H61 shared knowledge catalogue, self-service like the university picker:
 * anyone who offers or requests help can add a missing topic; equivalent
 * names (case, accents, spacing) resolve to the existing row. "Other" is not a
 * topic — requests carry `other` instead.
 */

export function normalizeTopicName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Identity used by the unique `help_topics.name_key`. */
export function topicKey(name: string): string {
  return normalizeTopicName(name).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en");
}

const RESERVED_KEYS = new Set(["other", "otro", "otros", "outro", "outros"]);

function assertNotReserved(name: string): void {
  if (RESERVED_KEYS.has(topicKey(name))) {
    throw new BadRequestError("Other is already offered on every request", {
      code: ERROR_REASONS.TOPIC_RESERVED,
    });
  }
}

function toTopic(row: { id: number; name: string }): HelpTopic {
  return { id: Number(row.id), name: row.name };
}

export async function searchTopics(q: string | undefined, limit: number): Promise<HelpTopic[]> {
  const term = q?.trim();
  const params: unknown[] = [limit];
  let where = "";
  let order = "lower(name), id";
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, topicKey(term));
    where = "WHERE unaccent(name) ILIKE unaccent($2)";
    // Exact, then prefix matches first, so "Vite" ranks above "Vitest".
    order = "(name_key = $3) DESC, (name_key LIKE $3 || '%') DESC, lower(name), id";
  }
  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM help_topics ${where} ORDER BY ${order} LIMIT $1`,
    params,
  );
  return rows.map(toTopic);
}

export async function createTopic(
  actorId: number,
  rawName: string,
): Promise<{ topic: HelpTopic; created: boolean }> {
  const name = normalizeTopicName(rawName);
  if (!name) throw new BadRequestError("Topic name is required");
  assertNotReserved(name);
  const key = topicKey(name);
  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: number; name: string }>(
      `INSERT INTO help_topics (name, name_key, proposed_by) VALUES ($1, $2, $3)
       ON CONFLICT (name_key) DO NOTHING RETURNING id, name`,
      [name, key, actorId],
    );
    if (inserted.rows[0]) {
      await audit(client, {
        actorId,
        entityType: "help_topic",
        entityId: inserted.rows[0].id,
        action: "created",
        after: { name },
      });
      return { topic: toTopic(inserted.rows[0]), created: true };
    }
    const { rows } = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM help_topics WHERE name_key = $1",
      [key],
    );
    return { topic: toTopic(rows[0] as { id: number; name: string }), created: false };
  });
}

export async function renameTopic(
  actorId: number,
  id: number,
  rawName: string,
): Promise<HelpTopic> {
  const name = normalizeTopicName(rawName);
  if (!name) throw new BadRequestError("Topic name is required");
  assertNotReserved(name);
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM help_topics WHERE id = $1 FOR UPDATE",
      [id],
    );
    const current = rows[0];
    if (!current) throw new NotFoundError("Topic not found");
    const { rows: clash } = await client.query(
      "SELECT 1 FROM help_topics WHERE name_key = $1 AND id <> $2",
      [topicKey(name), id],
    );
    if (clash[0]) {
      throw new ConflictError("Another topic already has this name; merge them instead", {
        code: ERROR_REASONS.TOPIC_NAME_TAKEN,
      });
    }
    if (current.name === name) return toTopic(current);
    const { rows: updated } = await client.query<{ id: number; name: string }>(
      "UPDATE help_topics SET name = $2, name_key = $3 WHERE id = $1 RETURNING id, name",
      [id, name, topicKey(name)],
    );
    await audit(client, {
      actorId,
      entityType: "help_topic",
      entityId: id,
      action: "renamed",
      before: { name: current.name },
      after: { name },
    });
    return toTopic(updated[0] as { id: number; name: string });
  });
}

/** Consolidate a duplicate: profiles and requests keep the target; the source goes. */
export async function mergeTopic(
  actorId: number,
  sourceId: number,
  targetId: number,
): Promise<HelpTopic> {
  if (sourceId === targetId) throw new BadRequestError("Choose a different topic to merge into");
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number; name: string }>(
      "SELECT id, name FROM help_topics WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
      [[sourceId, targetId]],
    );
    const source = rows.find((r) => Number(r.id) === sourceId);
    const target = rows.find((r) => Number(r.id) === targetId);
    if (!source || !target) throw new NotFoundError("Topic not found");
    await client.query(
      `INSERT INTO helper_topics (user_id, topic_id)
       SELECT user_id, $2 FROM helper_topics WHERE topic_id = $1
       ON CONFLICT DO NOTHING`,
      [sourceId, targetId],
    );
    await client.query(
      `INSERT INTO help_request_topics (request_id, topic_id)
       SELECT request_id, $2 FROM help_request_topics WHERE topic_id = $1
       ON CONFLICT DO NOTHING`,
      [sourceId, targetId],
    );
    await client.query("DELETE FROM help_topics WHERE id = $1", [sourceId]);
    await audit(client, {
      actorId,
      entityType: "help_topic",
      entityId: sourceId,
      action: "merged",
      before: { name: source.name },
      after: { targetId, targetName: target.name },
    });
    return toTopic(target);
  });
}

export async function assertTopicsExist(db: Queryable, topicIds: number[]): Promise<void> {
  if (topicIds.length === 0) return;
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM help_topics WHERE id = ANY($1::int[])",
    [topicIds],
  );
  if (rows[0]?.n !== new Set(topicIds).size) {
    throw new BadRequestError("Unknown topic", { code: ERROR_REASONS.TOPIC_UNKNOWN });
  }
}
