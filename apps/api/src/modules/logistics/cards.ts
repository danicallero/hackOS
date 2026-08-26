import type { Queryable } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";

/**
 * The "person card" a scanner shows staff: name, resolved food-intolerance
 * labels and profile notes (H22 accreditation, H25 meals). Intolerance ids on
 * `users.food_intolerances` are resolved to their i18n labels here so the
 * scanner never has to; the label jsonb ({en,es,gl}) is returned verbatim and
 * the client picks the language.
 */
export interface PersonCard {
  userId: number;
  name: string | null;
  surname: string | null;
  intolerances: { id: number; label: unknown }[];
  foodIntoleranceNotes: string | null;
  notes: string | null;
}

export async function loadPersonCard(db: Queryable, userId: number): Promise<PersonCard> {
  const { rows } = await db.query(
    `SELECT id, name, surname, food_intolerances, food_intolerance_notes, notes
       FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");

  const ids: number[] = u.food_intolerances ?? [];
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
    foodIntoleranceNotes: u.food_intolerance_notes,
    notes: u.notes,
  };
}
