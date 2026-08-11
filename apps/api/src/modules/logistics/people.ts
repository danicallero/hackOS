import { pool } from "../../db/pool.js";

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
): Promise<PersonSearchResult[]> {
  const needle = q.trim();
  if (!needle) return [];

  const ticket = await pool.query(
    `SELECT t.user_id FROM tickets t
      JOIN users u ON u.id = t.user_id
     WHERE upper(t.token) = upper($1) AND u.anonymized_at IS NULL`,
    [needle],
  );
  if (ticket.rows[0]) {
    return loadResults([ticket.rows[0].user_id as number], "ticket", fields);
  }

  const badge = await pool.query(
    `SELECT id FROM users WHERE upper(badge_id) = upper($1) AND anonymized_at IS NULL`,
    [needle],
  );
  if (badge.rows[0]) {
    return loadResults([badge.rows[0].id as number], "badge", fields);
  }

  const history = await pool.query(
    `SELECT id FROM users
      WHERE EXISTS (SELECT 1 FROM unnest(badge_id_history) b WHERE upper(b) = upper($1))
        AND anonymized_at IS NULL`,
    [needle],
  );
  if (history.rows.length > 0) {
    return loadResults(
      history.rows.map((r: { id: number }) => r.id),
      "badge_history",
      fields,
    );
  }

  // unaccent (migration 0505) makes the comparison accent-insensitive while
  // the stored names keep their accents: "ana per" finds "Ana Pérez".
  const like = `%${needle}%`;
  const fuzzy = await pool.query(
    `SELECT id FROM users
      WHERE anonymized_at IS NULL
        AND (unaccent(name) ILIKE unaccent($1)
         OR unaccent(surname) ILIKE unaccent($1)
         OR unaccent(email) ILIKE unaccent($1)
         OR unaccent(name || ' ' || surname) ILIKE unaccent($1)
         OR unaccent(surname || ' ' || name) ILIKE unaccent($1))
      ORDER BY surname NULLS LAST, name NULLS LAST, id
      LIMIT 10`,
    [like],
  );
  return loadResults(
    fuzzy.rows.map((r: { id: number }) => r.id),
    "profile",
    fields,
  );
}

async function loadResults(
  userIds: number[],
  matchedBy: PersonMatch,
  fields: PersonField[],
): Promise<PersonSearchResult[]> {
  if (userIds.length === 0) return [];
  const wanted = [...new Set(fields)];
  const extras = wanted.map((f) => `${PERSON_FIELD_SQL[f]} AS "${f}"`);
  const select = ["u.id", "u.name", "u.surname", ...extras].join(", ");
  const { rows } = await pool.query(
    `SELECT ${select}
       FROM users u
      WHERE u.id = ANY($1::int[])
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
