import type { FastifyRequest } from "fastify";
import type { Queryable } from "../../db/pool.js";
import { ConflictError } from "../../lib/errors.js";

/**
 * H8 full-replacement: the fixed admin/judge/sponsor/staff/mentor/
 * participant/unassigned bucket badge printing, wallet passes, scanner UI
 * and stats used to classify a user into (roles.badge_category) is retired —
 * a user's badge/wallet/scanner display label is simply the NAME of their
 * highest-position visible role, with no separate stored/selectable
 * category. The two seeded roles ('Mentor', 'Participant') that used to
 * carry a functional (not just cosmetic) badge_category are now identified
 * by name below.
 */
const ATTENDEE_ROLE_NAMES = { mentor: "Mentor", participant: "Participant" } as const;

export interface EffectiveRole {
  name: string;
}

/**
 * H8's actual "public role" concept: the user's highest-position role among
 * their assigned roles that is marked `is_visible` — or null if they hold no
 * visible role at all. Every consumer that used to switch on the fixed
 * DerivedRole enum (or its badge_category successor) now resolves through
 * this (or its thin wrapper getHighestVisibleRoleName below) instead of
 * guessing from capabilities/relationship tables and a stale
 * applications.type snapshot.
 */
export async function getEffectiveRole(
  db: Queryable,
  userId: number,
  request?: FastifyRequest,
): Promise<EffectiveRole | null> {
  void request;
  const { rows } = await db.query(
    `SELECT r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.is_visible = true AND r.deleted_at IS NULL
      ORDER BY r.position DESC
      LIMIT 1`,
    [userId],
  );
  const row = rows[0] as { name: string } | undefined;
  if (!row) return null;
  return { name: row.name };
}

/**
 * Whether this user's effective role (see getEffectiveRole) is the seeded
 * Mentor or Participant role, by name — kept as its own lookup (not just
 * inlined into its callers) because the schedule module's audience
 * resolution (H59: a schedule item's `participant`/`mentor` audience
 * toggles) and the announcements audience resolver need exactly this
 * question. Mutually exclusive: a user holds at most one of these two roles
 * at a time (identity/role.ts's assignAttendeeRole enforces the switch).
 */
export async function mentorOrParticipantType(
  db: Queryable,
  userId: number,
  request?: FastifyRequest,
): Promise<"mentor" | "participant" | null> {
  const { rows: activeRows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeRows[0]) return null;
  const effective = await getEffectiveRole(db, userId, request);
  if (effective?.name === ATTENDEE_ROLE_NAMES.mentor) return "mentor";
  if (effective?.name === ATTENDEE_ROLE_NAMES.participant) return "participant";
  return null;
}

/**
 * H8's actual "public role" concept, name only — the badge/wallet/scanner/
 * stats display label for a user. See getEffectiveRole for the underlying
 * lookup.
 */
export async function getHighestVisibleRoleName(
  db: Queryable,
  userId: number,
  request?: FastifyRequest,
): Promise<string | null> {
  const effective = await getEffectiveRole(db, userId, request);
  return effective?.name ?? null;
}

export interface AssignedRoleSummary {
  id: number;
  name: string;
  position: number;
  isVisible: boolean;
  eventAccess: boolean;
}

export type AttendeeType = "participant" | "mentor";

/**
 * Association fact for participant-facing navigation. This deliberately
 * reads the complete assigned-role set instead of the single display role:
 * a participant who also holds an operational role keeps participant tools.
 */
export function attendeeTypeFromAssignedRoles(
  roles: readonly Pick<AssignedRoleSummary, "name">[],
): AttendeeType | null {
  if (roles.some((role) => role.name === ATTENDEE_ROLE_NAMES.participant)) return "participant";
  if (roles.some((role) => role.name === ATTENDEE_ROLE_NAMES.mentor)) return "mentor";
  return null;
}

/**
 * The user's complete assigned-role set (H8), highest position first — not
 * just the single displayed role `getHighestVisibleRoleName` returns above.
 * Used by /api/me and /api/users/:id to show a full role list alongside the
 * one prominent "displayed role" (issue: profile role-list display).
 */
export async function getAssignedRoles(
  db: Queryable,
  userId: number,
): Promise<AssignedRoleSummary[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.position, r.is_visible, r.event_access
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.position DESC`,
    [userId],
  );
  return rows.map(
    (r: {
      id: number;
      name: string;
      position: number;
      is_visible: boolean;
      event_access: boolean;
    }) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      isVisible: r.is_visible,
      eventAccess: r.event_access,
    }),
  );
}

/**
 * Association-based facts underlying the illustrative `role` above, exposed
 * independently so navigation (H8/H55, issue #187) can show every relevant
 * workspace for a multi-capability account instead of collapsing to one
 * illustrative label — a sponsor rep who is also a judge needs both the
 * sponsor and judging workspaces, not whichever `role` wins priority.
 */
export async function computeMembershipFlags(
  db: Queryable,
  userId: number,
): Promise<{ isEnterpriseJudge: boolean; isSponsorRep: boolean }> {
  const [{ rows: judgeRows }, { rows: sponsorRows }] = await Promise.all([
    db.query(
      `SELECT 1 FROM enterprise_judges ej
        JOIN users u ON u.id = ej.user_id
       WHERE ej.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       LIMIT 1`,
      [userId],
    ),
    db.query(
      `SELECT 1 FROM sponsors s
        JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       LIMIT 1`,
      [userId],
    ),
  ]);
  return { isEnterpriseJudge: judgeRows.length > 0, isSponsorRep: sponsorRows.length > 0 };
}

/**
 * Whether this user currently holds event access. The role flag is the one
 * entitlement source: any assigned, non-deleted role with `event_access =
 * true` is enough, and losing one of several such roles does not matter until
 * the last one is gone. `is_visible` and effective capabilities are unrelated
 * presentation/authorization concerns. Ticket and mobile-app callers use
 * this same query so they cannot drift into separate eligibility rules.
 */
export async function hasEventAccess(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1
       FROM users u
       JOIN user_event_access uea ON uea.user_id = u.id
      WHERE u.id = $1
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

/**
 * H8/H10 full-replacement: grants the seeded Mentor/Participant role (0805)
 * that matches `category`, replacing whichever of the two the user
 * previously held from this same mechanism (a re-classification switches
 * type, it doesn't stack both). This is the write-side counterpart to
 * mentorOrParticipantType — used by PUT /api/users/:id/attendee-role and
 * accreditation's walk-in classification, the two call sites that used to
 * write `manual_attendee_roles` directly. That table is not written to by
 * either anymore (see 0808's migration comment); a genuinely explicit,
 * staff-driven classification is exactly what a real role grant is for,
 * unlike the retired applications.type guess. Caller must run this inside
 * their own transaction (client is expected to already hold a row lock on
 * the user, same as both call sites already do before this).
 */
export async function assignAttendeeRole(
  client: Queryable,
  userId: number,
  category: "mentor" | "participant",
  actorId: number,
): Promise<void> {
  const targetRoleName = ATTENDEE_ROLE_NAMES[category];
  const { rows: targetRows } = await client.query(
    `SELECT id FROM roles
      WHERE name = $1 AND is_seeded = true AND deleted_at IS NULL
      ORDER BY position DESC LIMIT 1`,
    [targetRoleName],
  );
  const targetRoleId = targetRows[0]?.id as number | undefined;
  if (!targetRoleId) {
    throw new ConflictError(
      `The seeded ${targetRoleName} role is missing or deleted — restore it before classifying attendees`,
      { category },
    );
  }
  // Drop the OTHER attendee role first (mentor <-> participant is a switch,
  // not additive) — scoped to roles this same mechanism could have granted,
  // never touching a role assigned through any other path.
  await client.query(
    `DELETE FROM user_roles ur
      USING roles r
     WHERE ur.role_id = r.id AND ur.user_id = $1
       AND r.name = ANY($3::text[]) AND r.id <> $2`,
    [userId, targetRoleId, [ATTENDEE_ROLE_NAMES.mentor, ATTENDEE_ROLE_NAMES.participant]],
  );
  await client.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
     VALUES ($1, $2, $3, 'attendee_role_assigned')
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, targetRoleId, actorId],
  );
}
