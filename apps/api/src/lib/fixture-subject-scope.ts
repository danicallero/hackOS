import type { Queryable } from "../db/pool.js";
import { ForbiddenError, NotFoundError } from "./errors.js";
import { fixtureSideSql } from "./sql-predicates.js";

/**
 * Synthetic App Store/QA operators are deliberately narrower than ordinary
 * capability holders. Their credentials may exercise the operational flows,
 * but only against synthetic subjects. This keeps a reviewer deployment safe
 * even if it is accidentally seeded with real event data.
 */
export async function isSyntheticOperator(db: Queryable, actorId: number): Promise<boolean> {
  const { rows } = await db.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [actorId],
  );
  return rows[0]?.is_test_account === true;
}

/**
 * H22-H27/H54: the people a scanner works with, as a SQL fragment over
 * `users u`. A real operator sees every real account; a synthetic operator
 * only the synthetic participant fixtures. Shared by the scanner roster (the
 * people finder), the role stats and the Live Activity counts so they always
 * describe the same population.
 */
export function scannerSubjectScope(fixtureOnly: boolean): string {
  return fixtureOnly
    ? ` AND u.is_test_account = true
        AND EXISTS (
          SELECT 1 FROM user_effective_role_name subject_role
           WHERE subject_role.user_id = u.id AND subject_role.role_name = 'Participant'
        )`
    : " AND u.is_test_account = false";
}

/**
 * Enforce the synthetic-operator boundary for a subject-targeted operation.
 * Ordinary event operators cannot discover synthetic subjects through a stale
 * id; the dedicated synthetic operator is restricted to synthetic subjects.
 */
export async function assertFixtureSubjectScope(
  db: Queryable,
  actorId: number,
  subjectUserId: number,
): Promise<void> {
  const { rows } = await db.query<{
    actor_is_test_account: boolean;
    subject_is_test_account: boolean;
  }>(
    `SELECT actor.is_test_account AS actor_is_test_account,
            subject.is_test_account AS subject_is_test_account
       FROM users actor
       JOIN users subject ON subject.id = $2
      WHERE actor.id = $1`,
    [actorId, subjectUserId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  if (row?.actor_is_test_account && !row.subject_is_test_account) {
    throw new ForbiddenError("Review fixture operators may only act on test accounts", {
      code: "review_fixture_scope",
    });
  }
  if (row && !row.actor_is_test_account && row.subject_is_test_account) {
    throw new NotFoundError("User not found");
  }
}

/**
 * Set-based `assertFixtureSubjectScope`: one actor read plus one subject read.
 * Returns, per offending subject id, the error the single-subject check would
 * throw (absent from the map when in scope), so callers can pick the first
 * offender in their own order.
 */
export async function fixtureSubjectScopeErrors(
  db: Queryable,
  actorId: number,
  subjectUserIds: number[],
): Promise<Map<number, ForbiddenError | NotFoundError>> {
  const out = new Map<number, ForbiddenError | NotFoundError>();
  if (subjectUserIds.length === 0) return out;
  const actor = await db.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [actorId],
  );
  const subjects = await db.query<{ id: number; is_test_account: boolean }>(
    `SELECT id, is_test_account FROM users WHERE id = ANY($1::int[])`,
    [subjectUserIds],
  );
  const actorIsTest = actor.rows[0]?.is_test_account;
  const subjectIsTest = new Map(subjects.rows.map((r) => [r.id, r.is_test_account]));
  for (const id of subjectUserIds) {
    const isTest = subjectIsTest.get(id);
    if (actorIsTest === undefined || isTest === undefined) {
      out.set(id, new NotFoundError("User not found"));
    } else if (actorIsTest && !isTest) {
      out.set(
        id,
        new ForbiddenError("Review fixture operators may only act on test accounts", {
          code: "review_fixture_scope",
        }),
      );
    } else if (!actorIsTest && isTest) {
      out.set(id, new NotFoundError("User not found"));
    }
  }
  return out;
}

/** Return a safe SQL fragment for a global operational read. */
export async function fixtureReadFilter(
  db: Queryable,
  actorId: number | undefined,
  alias: string,
): Promise<string> {
  if (actorId == null) return "";
  return ` AND ${fixtureSideSql(alias, await isSyntheticOperator(db, actorId))}`;
}
