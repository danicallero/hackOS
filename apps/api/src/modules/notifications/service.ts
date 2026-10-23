import { CHALLENGE_CATEGORY, EMAIL_OPT_IN_CATEGORIES } from "@hackos/shared/notification-channels";
import type { Queryable } from "../../db/pool.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";
import { assertFixtureSubjectScope } from "../logistics/review-fixture-scope.js";
import { type EmailPayload, normalizeLanguage, renderEmailTemplate } from "./templates.js";

/**
 * Public contract for the rest of the codebase (H51, H52, plan/07 §5.4):
 *
 *   import { notify } from "../notifications/service.js";
 *   await notify(client, { userId, category: "application.decision", payload: {...} });
 *
 * `notify` expands the requested channels through H51 preferences and
 * inserts one `notification_outbox` row per resulting channel — it never
 * sends anything itself, that's the dispatcher's job (dispatcher.ts). Siblings
 * that already insert outbox rows directly (raw INSERT) keep working: this is
 * a convenience wrapper over the same table, not a required entry point.
 *
 * Category 'queue' is the one operational exception (H51: "los avisos
 * operativos de mi turno de cola no son opcionales") — in-app and push always
 * fire, and email follows EMAIL_OPT_IN_CATEGORIES (always on without a device).
 */

export type NotificationChannel = "in_app" | "email" | "push";
export const ALL_CHANNELS: NotificationChannel[] = ["in_app", "email", "push"];
/** Channels used when a caller doesn't name any explicitly. */
export const DEFAULT_CHANNELS: NotificationChannel[] = ALL_CHANNELS;

export const QUEUE_CATEGORY = "queue";
export const QUEUE_STAFF_CATEGORY = "queue.staff";
/**
 * Shared channel config for every activity reminder (H51 rework): individual
 * (`schedule:<id>`) and kind (`schedule:type:<kind>`) opt-ins only decide
 * WHICH activities a user is reminded about — this category decides on
 * WHICH channels, for all of them at once. See schedule-reminders.ts.
 */
export const REMINDER_CHANNEL_CATEGORY = "schedule";

export interface NotifyOptions {
  userId: number;
  category: string;
  channels?: NotificationChannel[];
  payload: unknown;
  /** Optional actor boundary for staff-triggered notifications. */
  actorId?: number;
  /** Explicit fixture marker for system/queue fan-out without an actor. */
  fixtureMarker?: boolean;
}

export { CHALLENGE_CATEGORY, EMAIL_OPT_IN_CATEGORIES };

/** True when this person has at least one registered push device (mobile app signed in). */
export async function hasPushDevice(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM push_tokens WHERE user_id = $1) AS present`,
    [userId],
  );
  return rows[0]?.present === true;
}

/**
 * Expands `candidates` per H51 preferences: no explicit row = default enabled;
 * explicit row governs. Email-opt-in categories (see EMAIL_OPT_IN_CATEGORIES)
 * default email to "only without a push device"; the mandatory `queue`
 * category additionally never leaves someone unreachable: without a push
 * device its email cannot be switched off, so the notice always has a channel.
 */
export async function resolveChannels(
  db: Queryable,
  userId: number,
  category: string,
  candidates: NotificationChannel[],
): Promise<NotificationChannel[]> {
  const { rows } = await db.query(
    `SELECT channel, enabled FROM notification_preferences WHERE user_id = $1 AND category = $2`,
    [userId, category],
  );
  const overrides = new Map<string, boolean>(
    rows.map((r: { channel: string; enabled: boolean }) => [r.channel, r.enabled]),
  );
  const emailOptIn = EMAIL_OPT_IN_CATEGORIES.includes(category);
  const noDevice = emailOptIn && !(await hasPushDevice(db, userId));
  return candidates.filter((channel) => {
    if (category === QUEUE_CATEGORY && channel !== "email") return true;
    if (channel === "email" && emailOptIn) {
      // Queue notices must always reach someone: without a device, email can't be switched off.
      if (category === QUEUE_CATEGORY && noDevice) return true;
      return overrides.get("email") ?? noDevice;
    }
    return overrides.get(channel) ?? true;
  });
}

/**
 * The in_app row IS the inbox item (dispatchInApp just fans it out over SSE,
 * unrendered) and the inbox UI reads `payload.subject`/`payload.body`
 * directly — but callers that only name a `template` + `vars` (the pattern
 * every other channel uses, see templates.ts) never set those. Pre-render
 * them here so a caller can pass one payload shape and land readably on
 * every channel, in_app included, without knowing about templates itself.
 * Callers that already set an explicit subject/body keep it verbatim.
 */
async function withInboxRendering(
  db: Queryable,
  userId: number,
  channel: NotificationChannel,
  payload: unknown,
): Promise<unknown> {
  if (channel !== "in_app") return payload;
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as EmailPayload & Record<string, unknown>;
  if (typeof p.subject === "string" || !p.template) return payload;
  const { rows } = await db.query(
    `SELECT language FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  const language = normalizeLanguage((rows[0] as { language?: string } | undefined)?.language);
  const rendered = renderEmailTemplate(p, language);
  return { ...p, subject: rendered.subject, body: rendered.text };
}

/** Enqueues outbox rows for `opts.userId`, one per resolved channel. Returns the inserted row ids. */
export async function notify(db: Queryable, opts: NotifyOptions): Promise<number[]> {
  // Removal takes the same row lock before changing account_state. This share
  // lock prevents a caller that is already in a transaction from enqueueing a
  // new identity-bearing notification after closure has committed (H54).
  const active = await db.query<{ id: number; is_test_account: boolean }>(
    `SELECT id, is_test_account FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [opts.userId],
  );
  if (!active.rows[0]) throw new NotFoundError("User not found", { userId: opts.userId });
  const targetIsSynthetic = active.rows[0].is_test_account === true;
  if (opts.fixtureMarker !== undefined && targetIsSynthetic !== opts.fixtureMarker) {
    throw new NotFoundError("User not found", { userId: opts.userId });
  }
  if (opts.actorId != null) {
    await assertFixtureSubjectScope(db, opts.actorId, opts.userId);
  }
  const candidates = opts.channels ?? DEFAULT_CHANNELS;
  const channels = await resolveChannels(db, opts.userId, opts.category, candidates);
  const ids: number[] = [];
  for (const channel of channels) {
    const rowPayload = await withInboxRendering(db, opts.userId, channel, opts.payload);
    const { rows } = await db.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.userId, opts.category, channel, JSON.stringify(rowPayload ?? {})],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

// ── H51 preferences API ─────────────────────────────────────────────────────

export interface PreferenceRow {
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * Static categories every user can see in the matrix even with zero override
 * rows. `schedule` is the shared channel config for all activity reminders
 * (H51 rework); the per-activity/per-kind opt-in rows themselves
 * (`schedule:<id>`, `schedule:type:<kind>`) are membership markers, not
 * channel rows, and stay out of this table.
 */
export const STATIC_CATEGORIES = [
  "announcements",
  "application",
  "project",
  CHALLENGE_CATEGORY,
  REMINDER_CHANNEL_CATEGORY,
];

export async function getPreferences(
  db: Queryable,
  userId: number,
): Promise<{
  channels: NotificationChannel[];
  mandatoryCategories: string[];
  emailOptInCategories: string[];
  hasPushDevice: boolean;
  onboardingRequired: boolean;
  overrides: PreferenceRow[];
}> {
  const { rows } = await db.query(
    `SELECT category, channel, enabled FROM notification_preferences WHERE user_id = $1 ORDER BY category, channel`,
    [userId],
  );
  const { rows: userRows } = await db.query(
    `SELECT notification_onboarded_at IS NULL AS pending FROM users WHERE id = $1`,
    [userId],
  );
  return {
    channels: ALL_CHANNELS,
    mandatoryCategories: [QUEUE_CATEGORY],
    emailOptInCategories: EMAIL_OPT_IN_CATEGORIES,
    hasPushDevice: await hasPushDevice(db, userId),
    onboardingRequired: userRows[0]?.pending === true && (await hasEventAccess(db, userId)),
    overrides: rows,
  };
}

/**
 * Stores the channel choices from the first-run prompt and stamps the user as
 * onboarded so no device asks again. Idempotent: a repeat call keeps the
 * first timestamp.
 */
export async function completeNotificationOnboarding(
  db: Queryable,
  userId: number,
  items: PreferenceRow[],
): Promise<void> {
  await setPreferences(db, userId, items);
  await db.query(
    `UPDATE users SET notification_onboarded_at = COALESCE(notification_onboarded_at, now())
      WHERE id = $1`,
    [userId],
  );
}

export async function setPreferences(
  db: Queryable,
  userId: number,
  items: PreferenceRow[],
): Promise<void> {
  const { rows: activeRows } = await db.query(
    `SELECT id FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR UPDATE`,
    [userId],
  );
  if (!activeRows[0]) throw new NotFoundError("User not found", { userId });
  for (const item of items) {
    if (item.category === QUEUE_CATEGORY && item.channel !== "email") {
      throw new BadRequestError(
        `Category "${QUEUE_CATEGORY}" is mandatory (H51); only its email can be chosen`,
      );
    }
    if (item.category === QUEUE_STAFF_CATEGORY && item.channel !== "push") {
      throw new BadRequestError(`Category "${QUEUE_STAFF_CATEGORY}" only supports push`);
    }
    await db.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, category, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, item.category, item.channel, item.enabled],
    );
  }
}

// ── in-app inbox (H50, H51) ─────────────────────────────────────────────────

export interface InboxItem {
  id: number;
  category: string;
  payload: unknown;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export async function listInboxNotifications(
  db: Queryable,
  userId: number,
  opts: { unreadOnly?: boolean; limit: number; offset: number },
): Promise<{ items: InboxItem[]; total: number }> {
  const unreadClause = opts.unreadOnly ? "AND read_at IS NULL" : "";
  const { rows } = await db.query(
    `SELECT id, category, payload, status, sent_at, read_at, created_at
     FROM notification_outbox
     WHERE user_id = $1 AND channel = 'in_app' ${unreadClause}
     ORDER BY id DESC
     LIMIT $2 OFFSET $3`,
    [userId, opts.limit, opts.offset],
  );
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS count FROM notification_outbox
     WHERE user_id = $1 AND channel = 'in_app' ${unreadClause}`,
    [userId],
  );
  return { items: rows, total: countRows[0].count };
}

export async function markNotificationRead(
  db: Queryable,
  userId: number,
  notificationId: number,
): Promise<{ id: number; read_at: string }> {
  const { rows } = await db.query(
    `UPDATE notification_outbox
     SET read_at = COALESCE(read_at, now())
     WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
     RETURNING id, read_at`,
    [notificationId, userId],
  );
  if (!rows[0]) throw new NotFoundError("Notification not found");
  return rows[0];
}

/** H51: clears the read marker so an inbox item counts as unread again (idempotent). */
export async function markNotificationUnread(
  db: Queryable,
  userId: number,
  notificationId: number,
): Promise<{ id: number; read_at: null }> {
  const { rows } = await db.query(
    `UPDATE notification_outbox
     SET read_at = NULL
     WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
     RETURNING id, read_at`,
    [notificationId, userId],
  );
  if (!rows[0]) throw new NotFoundError("Notification not found");
  return rows[0];
}

export async function deleteInboxNotification(
  db: Queryable,
  userId: number,
  notificationId: number,
): Promise<{ id: number }> {
  const { rows } = await db.query(
    `DELETE FROM notification_outbox
     WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
     RETURNING id`,
    [notificationId, userId],
  );
  if (!rows[0]) throw new NotFoundError("Notification not found");
  return rows[0];
}
