import { CHALLENGE_CATEGORY, EMAIL_OPT_IN_CATEGORIES } from "@hackos/shared/notification-channels";
import type { Queryable } from "../../db/pool.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";
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
 * Pure channel expansion shared by the single and batched resolvers.
 * `overrides` is the user's explicit rows for the category (channel -> enabled).
 */
function applyChannelRules(
  category: string,
  candidates: NotificationChannel[],
  overrides: Map<string, boolean>,
  hasDevice: boolean,
): NotificationChannel[] {
  const emailOptIn = EMAIL_OPT_IN_CATEGORIES.includes(category);
  const noDevice = emailOptIn && !hasDevice;
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
  const needsDevice = EMAIL_OPT_IN_CATEGORIES.includes(category);
  const hasDevice = needsDevice ? await hasPushDevice(db, userId) : true;
  return applyChannelRules(category, candidates, overrides, hasDevice);
}

export interface ResolveChannelsRequest {
  userId: number;
  category: string;
  candidates: NotificationChannel[];
}

/** Set-based `resolveChannels`: two queries for the whole batch, results in request order. */
export async function resolveChannelsMany(
  db: Queryable,
  requests: ResolveChannelsRequest[],
): Promise<NotificationChannel[][]> {
  if (requests.length === 0) return [];
  const userIds = [...new Set(requests.map((r) => r.userId))];
  const categories = [...new Set(requests.map((r) => r.category))];
  const { rows: prefRows } = await db.query<{
    user_id: number;
    category: string;
    channel: string;
    enabled: boolean;
  }>(
    `SELECT user_id, category, channel, enabled FROM notification_preferences
      WHERE user_id = ANY($1::int[]) AND category = ANY($2::text[])`,
    [userIds, categories],
  );
  const overridesByKey = new Map<string, Map<string, boolean>>();
  for (const r of prefRows) {
    const key = `${r.user_id}\u0000${r.category}`;
    const m = overridesByKey.get(key) ?? new Map<string, boolean>();
    overridesByKey.set(key, m);
    m.set(r.channel, r.enabled);
  }
  const needsDeviceUsers = [
    ...new Set(
      requests.filter((r) => EMAIL_OPT_IN_CATEGORIES.includes(r.category)).map((r) => r.userId),
    ),
  ];
  const withDevice = new Set<number>();
  if (needsDeviceUsers.length > 0) {
    const { rows } = await db.query<{ user_id: number }>(
      `SELECT DISTINCT user_id FROM push_tokens WHERE user_id = ANY($1::int[])`,
      [needsDeviceUsers],
    );
    for (const r of rows) withDevice.add(r.user_id);
  }
  return requests.map((r) =>
    applyChannelRules(
      r.category,
      r.candidates,
      overridesByKey.get(`${r.userId}\u0000${r.category}`) ?? new Map(),
      withDevice.has(r.userId),
    ),
  );
}

/** True when the payload names a template but no subject, so the inbox row needs pre-rendering. */
function needsInboxRendering(payload: unknown): payload is EmailPayload & Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as EmailPayload & Record<string, unknown>;
  return typeof p.subject !== "string" && Boolean(p.template);
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
function renderInboxPayload(
  payload: EmailPayload & Record<string, unknown>,
  rawLanguage: string | undefined,
): unknown {
  const rendered = renderEmailTemplate(payload, normalizeLanguage(rawLanguage));
  return { ...payload, subject: rendered.subject, body: rendered.text };
}

/** Enqueues outbox rows for `opts.userId`, one per resolved channel. Returns the inserted row ids. */
export async function notify(db: Queryable, opts: NotifyOptions): Promise<number[]> {
  return (await notifyMany(db, [opts]))[0] as number[];
}

/**
 * Set-based `notify` for fan-out loops: same checks and semantics per item
 * (FOR SHARE active-user lock, fixture/actor scope, H51 channel resolution,
 * inbox pre-rendering, one outbox row per channel) in a constant number of
 * queries regardless of batch size. Returns the inserted ids per item, in
 * input order. Throws the same errors `notify` would for the first offending
 * item; callers run in a transaction, so a throw leaves nothing enqueued.
 */
export async function notifyMany(db: Queryable, items: NotifyOptions[]): Promise<number[][]> {
  if (items.length === 0) return [];
  // Removal takes the same row lock before changing account_state. This share
  // lock prevents a caller that is already in a transaction from enqueueing a
  // new identity-bearing notification after closure has committed (H54).
  // Locked in id order so concurrent batches cannot deadlock each other.
  const userIds = [...new Set(items.map((i) => i.userId))].sort((a, b) => a - b);
  const { rows: userRows } = await db.query<{
    id: number;
    is_test_account: boolean;
    language: string | null;
  }>(
    `SELECT id, is_test_account, language FROM users
      WHERE id = ANY($1::int[]) AND account_state = 'active' AND anonymized_at IS NULL
      ORDER BY id
        FOR SHARE`,
    [userIds],
  );
  const userById = new Map(userRows.map((u) => [u.id, u]));
  for (const item of items) {
    const user = userById.get(item.userId);
    if (!user) throw new NotFoundError("User not found", { userId: item.userId });
    if (item.fixtureMarker !== undefined && user.is_test_account !== item.fixtureMarker) {
      throw new NotFoundError("User not found", { userId: item.userId });
    }
  }

  // Actor boundary (same rules as assertFixtureSubjectScope).
  const actorIds = [...new Set(items.flatMap((i) => (i.actorId != null ? [i.actorId] : [])))];
  if (actorIds.length > 0) {
    const { rows: actorRows } = await db.query<{ id: number; is_test_account: boolean }>(
      `SELECT id, is_test_account FROM users WHERE id = ANY($1::int[])`,
      [actorIds],
    );
    const actorSynthetic = new Map(actorRows.map((a) => [a.id, a.is_test_account === true]));
    for (const item of items) {
      if (item.actorId == null) continue;
      const actorIsTest = actorSynthetic.get(item.actorId);
      if (actorIsTest === undefined) throw new NotFoundError("User not found");
      const subjectIsTest = (userById.get(item.userId) as { is_test_account: boolean })
        .is_test_account;
      if (actorIsTest && !subjectIsTest) {
        throw new ForbiddenError("Review fixture operators may only act on test accounts", {
          code: "review_fixture_scope",
        });
      }
      if (!actorIsTest && subjectIsTest) throw new NotFoundError("User not found");
    }
  }

  const resolved = await resolveChannelsMany(
    db,
    items.map((i) => ({
      userId: i.userId,
      category: i.category,
      candidates: i.channels ?? DEFAULT_CHANNELS,
    })),
  );

  const rowItem: number[] = [];
  const rowUser: number[] = [];
  const rowCategory: string[] = [];
  const rowChannel: string[] = [];
  const rowPayload: string[] = [];
  items.forEach((item, idx) => {
    const user = userById.get(item.userId) as { language: string | null };
    for (const channel of resolved[idx] as NotificationChannel[]) {
      const payload =
        channel === "in_app" && needsInboxRendering(item.payload)
          ? renderInboxPayload(item.payload, user.language ?? undefined)
          : item.payload;
      rowItem.push(idx);
      rowUser.push(item.userId);
      rowCategory.push(item.category);
      rowChannel.push(channel);
      rowPayload.push(JSON.stringify(payload ?? {}));
    }
  });
  const ids: number[][] = items.map(() => []);
  if (rowItem.length === 0) return ids;
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     SELECT t.user_id, t.category, t.channel::public.notification_channel, t.payload::jsonb
       FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY
            AS t(user_id, category, channel, payload, ord)
      ORDER BY t.ord
     RETURNING id`,
    [rowUser, rowCategory, rowChannel, rowPayload],
  );
  // Ids are allocated in ORDER BY ord order, so ascending ids map back to rows.
  const sorted = rows.map((r) => r.id).sort((a, b) => a - b);
  sorted.forEach((id, i) => {
    (ids[rowItem[i] as number] as number[]).push(id);
  });
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
  }
  if (items.length === 0) return;
  // Last write wins per (category, channel); one statement cannot upsert a key twice.
  const latest = new Map<string, PreferenceRow>();
  for (const item of items) latest.set(`${item.category}\u0000${item.channel}`, item);
  const rows = [...latest.values()];
  await db.query(
    `INSERT INTO notification_preferences (user_id, category, channel, enabled)
     SELECT $1::int, t.category, t.channel::public.notification_channel, t.enabled
       FROM unnest($2::text[], $3::text[], $4::boolean[]) AS t(category, channel, enabled)
     ON CONFLICT (user_id, category, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [userId, rows.map((r) => r.category), rows.map((r) => r.channel), rows.map((r) => r.enabled)],
  );
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
