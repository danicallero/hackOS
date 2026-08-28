import type { Queryable } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";

/**
 * The "person card" a scanner shows staff: name, resolved food-intolerance
 * labels and profile notes (H22 accreditation, H25 meals). Intolerance ids on
 * `users.food_intolerances` are resolved to their i18n labels here so the
 * scanner never has to; the label jsonb ({en,es,gl}) is returned verbatim and
 * the client picks the language. A removal-pending participant is an exit-only
 * exception: the name is still needed to identify the person at the door, but
 * dietary and free-text profile data are no longer operationally necessary.
 */
export interface PersonCard {
  userId: number;
  name: string | null;
  surname: string | null;
  intolerances: { id: number; label: unknown }[];
  foodIntoleranceNotes: string | null;
  notes: string | null;
  /** Present only for callers that explicitly request pending-exit metadata. */
  pendingExit?: boolean;
}

export async function loadPersonCard(
  db: Queryable,
  userId: number,
  options: { allowPendingExit?: boolean; includePendingExitMarker?: boolean } = {},
): Promise<PersonCard> {
  const { rows } = await db.query(
    `SELECT id, name, surname, food_intolerances, food_intolerance_notes, notes, account_state
       FROM users
      WHERE id = $1
        AND anonymized_at IS NULL
        AND (
          account_state = 'active'
          OR ($2::boolean AND account_state = 'removal_pending' AND removal_requires_exit = true)
        )`,
    [userId, options.allowPendingExit === true],
  );
  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");

  const exitOnly = u.account_state === "removal_pending";
  const ids: number[] = exitOnly ? [] : (u.food_intolerances ?? []);
  let intolerances: { id: number; label: unknown }[] = [];
  if (ids.length > 0) {
    const r = await db.query(`SELECT id, label FROM food_intolerances WHERE id = ANY($1)`, [ids]);
    intolerances = r.rows.map((x: { id: number; label: unknown }) => ({
      id: x.id,
      label: x.label,
    }));
  }

  return {
    userId: u.id,
    name: u.name,
    surname: u.surname,
    intolerances,
    foodIntoleranceNotes: exitOnly ? null : u.food_intolerance_notes,
    notes: exitOnly ? null : u.notes,
    ...(options.includePendingExitMarker ? { pendingExit: exitOnly } : {}),
  };
}
