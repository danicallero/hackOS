import { pool } from "../../db/pool.js";
import { fixtureReadFilter } from "./review-fixture-scope.js";

// ── H22/H23: unified person lookup ─────────────────────────────────────────

export type PersonMatch = "ticket" | "badge" | "badge_history" | "profile";

/**
 * User fields a caller may ask the person search to return, mapped to their
 * SQL expression. Whitelist — the schema enum is derived from these keys, so
 * nothing outside this map can ever be selected.
 */
const PERSON_FIELD_SQL = {
  email: "u.email",
  badgeId: "u.badge_id",
  dni: "u.dni",
  shirtSize: "u.shirt_size",
  notes: "u.notes",
  confirmed: `EXISTS (
    SELECT 1 FROM application_responses ar
     WHERE ar.user_id = u.id AND ar.status = 'confirmed')`,
} as const;

export type PersonField = keyof typeof PERSON_FIELD_SQL;
export const PERSON_FIELDS = Object.keys(PERSON_FIELD_SQL) as [PersonField, ...PersonField[]];
export const DEFAULT_PERSON_FIELDS: PersonField[] = ["email", "badgeId", "confirmed"];

export interface PersonSearchResult {
  userId: number;
  name: string | null;
  surname: string | null;
  matchedBy: PersonMatch;
  [field: string]: unknown;
}

/**
 * One search box for any logistics station. Every comparison is
 * case-insensitive. `q` is tried, in order, as:
 *   1. an exact ticket token,
 *   2. the CURRENT badge of someone (a rotated-away badge never shadows the
 *      person who holds that id now),
 *   3. a rotated-away badge (matchedBy "badge_history", so callers can tell),
 *   4. a name / surname / "name surname" / "surname name" / email substring.
 * Exact identifier hits short-circuit the fuzzy search so a scanned QR always
 * resolves to exactly one person. `fields` picks which extra user fields come
 * back (see PERSON_FIELDS). Read-only.
 */
export async function searchPeople(
  q: string,
  fields: PersonField[] = DEFAULT_PERSON_FIELDS,
  actorId?: number,
): Promise<PersonSearchResult[]> {
  const needle = q.trim();
  if (!needle) return [];
  const fixtureFilter = await fixtureReadFilter(pool, actorId, "u");

  const ticket = await pool.query(
    `SELECT t.user_id FROM tickets t
      JOIN users u ON u.id = t.user_id
     WHERE upper(t.token) = upper($1) AND u.account_state = 'active' AND u.anonymized_at IS NULL${fixtureFilter}`,
    [needle],
  );
  if (ticket.rows[0]) {
    return loadResults([ticket.rows[0].user_id as number], "ticket", fields, actorId);
  }

  const badge = await pool.query(
    `SELECT u.id FROM users u WHERE upper(u.badge_id) = upper($1) AND u.account_state = 'active' AND u.anonymized_at IS NULL${fixtureFilter}`,
    [needle],
  );
  if (badge.rows[0]) {
    return loadResults([badge.rows[0].id as number], "badge", fields, actorId);
  }

  const history = await pool.query(
    `SELECT u.id FROM users u
      WHERE EXISTS (SELECT 1 FROM unnest(u.badge_id_history) b WHERE upper(b) = upper($1))
        AND u.account_state = 'active' AND u.anonymized_at IS NULL${fixtureFilter}`,
    [needle],
  );
  if (history.rows.length > 0) {
    return loadResults(
      history.rows.map((r: { id: number }) => r.id),
      "badge_history",
      fields,
      actorId,
    );
  }

  // unaccent (migration 0505) makes the comparison accent-insensitive while
  // the stored names keep their accents: "ana per" finds "Ana Pérez".
  const like = `%${needle}%`;
  const fuzzy = await pool.query(
    `SELECT u.id FROM users u
      WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
        ${fixtureFilter}
        AND (unaccent(u.name) ILIKE unaccent($1)
         OR unaccent(u.surname) ILIKE unaccent($1)
         OR unaccent(u.email) ILIKE unaccent($1)
         OR unaccent(u.name || ' ' || u.surname) ILIKE unaccent($1)
         OR unaccent(u.surname || ' ' || u.name) ILIKE unaccent($1))
      ORDER BY u.surname NULLS LAST, u.name NULLS LAST, u.id
      LIMIT 10`,
    [like],
  );
  return loadResults(
    fuzzy.rows.map((r: { id: number }) => r.id),
    "profile",
    fields,
    actorId,
  );
}

export interface RosterEntry {
  userId: number;
  name: string | null;
  surname: string | null;
  email: string;
  badgeId: string | null;
  dni: string | null;
  role: string | null;
  confirmed: boolean;
  present: boolean;
}

/**
 * Full active roster for a client-side people finder (mirrors the mobile
 * scanner's offline-synced directory, apps/mobile/lib/scanner-db.ts). Unlike
 * `searchPeople`, this has no query — the caller filters locally. Capped so
 * an unbounded roster can't turn this into an unpaginated full-table read.
 * `role`/`present` reuse the same read models as scanner-sync.ts's snapshot
 * (H8 effective role name; ground-truth last door scan, not an estimate).
 */
export async function listPeople(actorId?: number): Promise<RosterEntry[]> {
  const fixtureFilter = await fixtureReadFilter(pool, actorId, "u");
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.surname, u.email, u.badge_id, u.dni, uern.role_name AS role,
            EXISTS (
              SELECT 1 FROM application_responses ar
               WHERE ar.user_id = u.id AND ar.status = 'confirmed'
            ) AS confirmed,
            last_presence.kind = 'in' AS present
       FROM users u
       LEFT JOIN user_effective_role_name uern ON uern.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT tl.kind FROM time_logs tl
          WHERE tl.user_id = u.id AND tl.scanned_at <= now()
          ORDER BY tl.scanned_at DESC, tl.id DESC
          LIMIT 1
       ) last_presence ON true
      WHERE u.account_state = 'active' AND u.anonymized_at IS NULL${fixtureFilter}
      ORDER BY u.surname NULLS LAST, u.name NULLS LAST, u.id
      LIMIT 2000`,
  );
  return (
    rows as {
      id: number;
      name: string | null;
      surname: string | null;
      email: string;
      badge_id: string | null;
      dni: string | null;
      role: string | null;
      confirmed: boolean;
      present: boolean | null;
    }[]
  ).map((r) => ({
    userId: r.id,
    name: r.name,
    surname: r.surname,
    email: r.email,
    badgeId: r.badge_id,
    dni: r.dni,
    role: r.role,
    confirmed: r.confirmed,
    present: Boolean(r.present),
  }));
}

async function loadResults(
  userIds: number[],
  matchedBy: PersonMatch,
  fields: PersonField[],
  actorId?: number,
): Promise<PersonSearchResult[]> {
  if (userIds.length === 0) return [];
  const wanted = [...new Set(fields)];
  const extras = wanted.map((f) => `${PERSON_FIELD_SQL[f]} AS "${f}"`);
  const select = ["u.id", "u.name", "u.surname", ...extras].join(", ");
  const fixtureFilter = await fixtureReadFilter(pool, actorId, "u");
  const { rows } = await pool.query(
    `SELECT ${select}
       FROM users u
      WHERE u.id = ANY($1::int[])
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL${fixtureFilter}
      ORDER BY array_position($1::int[], u.id)`,
    [userIds],
  );
  return rows.map((r: Record<string, unknown>) => {
    const result: PersonSearchResult = {
      userId: r.id as number,
      name: (r.name ?? null) as string | null,
      surname: (r.surname ?? null) as string | null,
      matchedBy,
    };
    for (const f of wanted) result[f] = r[f] ?? null;
    return result;
  });
}
