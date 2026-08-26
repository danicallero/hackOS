import { DEFAULT_ACTIVITY_KIND, isMealActivityKind } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { computeMembershipFlags, mentorOrParticipantType } from "../identity/role.js";
import { normalizeLanguage } from "../notifications/templates.js";
import type { Language } from "../notifications/translate/index.js";
import { isTranslationAvailable, translateFields } from "../notifications/translate/index.js";

const SCHEDULE_COLUMNS =
  "id, title, description, location, type, requires_scan, starts_at, ends_at, visibility, publish_at, reminded_at, audiences, contact_note, notes, primary_language, title_i18n, description_i18n, created_at, updated_at";

const ALL_LANGUAGES: Language[] = ["es", "gl", "en"];

/**
 * Extends H50's translate-on-demand mechanism (announcements) to schedule
 * items (and, mirrored, their linked activity — see the `activities`
 * mirroring in createScheduleItem/updateScheduleItem/saveScheduleTranslations
 * below): `title`/`description` stay the canonical mirror of whatever
 * language the item was authored in. That language (`primaryLanguage`) is
 * never chosen by hand — it's set once at creation from the author's own
 * account language (`users.language`) and never changes after, so there's no
 * picker in either client; staff just type the title/description, in
 * whatever language actually comes out (translation always auto-detects the
 * source rather than trusting this field — see translateScheduleContent).
 * Per-field `_i18n` jsonb columns (title_i18n/description_i18n), matching
 * the challenges (H44) convention rather than announcements' single blob, so
 * title and description can be filled independently. Once a locale has
 * translated text, automatic translation never overwrites it again (mirrors
 * announcements' "only fill languages that are still empty" rule) — to redo
 * one, blank it out by hand first, then translate again.
 */
export type ScheduleTranslation = { title?: string; description?: string | null };
export type ScheduleTranslations = Partial<Record<Language, ScheduleTranslation>>;

/**
 * A scanner activity mirrors its schedule item's category verbatim (H25, H26)
 * — the kind ids are the shared registry's, so "which categories are meals"
 * is answered by `isMealActivityKind`, never by a hardcoded `'meal'`.
 */
function toActivityCategory(type: string | null): string {
  return type ?? DEFAULT_ACTIVITY_KIND;
}

/**
 * Who a live schedule item is shown to, on top of always-on staff visibility
 * (staff see every live item unconditionally — never stored). Empty is valid
 * and means "staff-only". `participant` also drives the anonymous public
 * site/TV feed (H59) — there's no audience distinct from "what participants
 * see" for an anonymous visitor.
 */
export type ScheduleAudience = "sponsor" | "participant" | "mentor";

export interface ScheduleInput {
  title: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  requiresScan?: boolean;
  startsAt: Date;
  endsAt: Date;
  visibility: "shown" | "hidden";
  publishAt?: Date | null;
  audiences?: ScheduleAudience[];
  contactNote?: string | null;
  notes?: string | null;
}

export interface SchedulePatch {
  title?: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  requiresScan?: boolean;
  startsAt?: Date;
  endsAt?: Date;
  visibility?: "shown" | "hidden";
  publishAt?: Date | null;
  audiences?: ScheduleAudience[];
  contactNote?: string | null;
  notes?: string | null;
}

function serialize(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    type: (row.type as string | null) ?? null,
    requiresScan: Boolean(row.requires_scan),
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    visibility: String(row.visibility),
    publishAt: row.publish_at instanceof Date ? row.publish_at.toISOString() : null,
    remindedAt: row.reminded_at instanceof Date ? row.reminded_at.toISOString() : null,
    audiences: (row.audiences as string[] | null) ?? [],
    contactNote: (row.contact_note as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    primaryLanguage: (row.primary_language as Language | null) ?? "es",
    titleI18n: (row.title_i18n as Record<string, string> | null) ?? {},
    descriptionI18n: (row.description_i18n as Record<string, string | null> | null) ?? {},
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

/**
 * A staff-only item (no audience tags) has no meaningful "visibility" at
 * all — it's neither public nor private, staff sees it unconditionally
 * regardless (H59 follow-up, schedule_visibility_requires_audience 0720).
 * `visibility`/`publish_at` only describe when a *tagged* audience gets to
 * see an item, so they're forced back to their staff-only defaults the
 * moment an item ends up with no audience — silently, not a validation
 * error, since "remove the last audience tag" is a normal edit and
 * shouldn't require a second step to also blank these out.
 */
function normalizeVisibilityForAudiences<
  T extends { visibility: "shown" | "hidden"; publishAt: Date | null },
>(next: T, audiences: readonly string[]): T {
  if (audiences.length > 0) return next;
  return { ...next, visibility: "hidden", publishAt: null };
}

/**
 * Hiding an item by hand has to stick. `publish_at` is left behind when the
 * publisher reveals an item (revealDueScheduleItems), so an item hidden again
 * later still carries a due date — and the next publisher tick would flip it
 * straight back to 'shown'. A publish date already in the past has done its
 * job, so clear it whenever staff hides an item; a *future* one survives,
 * since "hide it again until Saturday" is a real intent (H59).
 */
function clearSpentPublishAt<T extends { visibility: "shown" | "hidden"; publishAt: Date | null }>(
  next: T,
  now = new Date(),
): T {
  if (next.visibility !== "hidden" || next.publishAt === null) return next;
  return next.publishAt.getTime() <= now.getTime() ? { ...next, publishAt: null } : next;
}

/** The account's own UI language (`users.language`), defaulted like every other language lookup in the codebase (templates.ts's normalizeLanguage). */
async function getUserLanguage(userId: number): Promise<Language> {
  const { rows } = await pool.query(`SELECT language FROM users WHERE id = $1`, [userId]);
  return normalizeLanguage((rows[0] as { language?: string } | undefined)?.language);
}

function assertWindow(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestError("endsAt must be after startsAt");
  }
}

/**
 * A scanner station reads a badge against an activity the *attendee* can
 * already see is happening — a staff/sponsor/mentor-only item has no
 * business being scannable (H59). `participant` is the anonymous-visible
 * audience (see `ScheduleAudience`), so it's the one that gates scanning.
 */
function assertScanRequiresParticipantAudience(
  requiresScan: boolean,
  audiences: readonly string[],
) {
  if (requiresScan && !audiences.includes("participant")) {
    throw new BadRequestError("Only a participant-visible item can require scanning");
  }
}

export async function emitScheduleChanged(data: unknown) {
  await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_SCHEDULE_CHANGED, data);
}

/**
 * Scheduled reveal trigger (H47/H48, issue #80). Mirrors
 * challenges/service.ts's revealDueChallenges: a bare UPDATE...WHERE is
 * concurrency-safe on its own (row locks acquired atomically by Postgres),
 * no explicit SELECT...FOR UPDATE needed for this style of flip. Unlike
 * challenges, publish_at is left intact rather than nulled — admins still
 * see "when this was scheduled to go live" via serialize()/GET /api/schedule,
 * and leaving it doesn't cause re-triggering since visibility='hidden' no
 * longer matches once flipped. Never touches a staff-only (empty-audience)
 * item — schedule_visibility_requires_audience (0720) guarantees those never
 * carry a publish_at in the first place, since "reveal" only means anything
 * for an item some non-staff audience is waiting on.
 */
export async function revealDueScheduleItems(client: Queryable = pool): Promise<number[]> {
  const { rows } = await client.query(
    `UPDATE schedule
        SET visibility = 'shown'
      WHERE visibility = 'hidden'
        AND publish_at IS NOT NULL
        AND publish_at <= now()
      RETURNING id`,
  );
  return rows.map((r: { id: number }) => Number(r.id));
}

/** Shared by listSchedule and listScheduleForAudiences (H59) — one owners query for a batch of ids. */
async function loadOwnersByScheduleId(ids: number[]): Promise<Map<number, ScheduleOwner[]>> {
  const ownersByScheduleId = new Map<number, ScheduleOwner[]>();
  if (ids.length === 0) return ownersByScheduleId;
  const { rows: ownerRows } = await pool.query(
    `SELECT so.id, so.schedule_id, so.user_id, u.name, u.surname, u.email,
            so.free_text_name, so.assigned_at
      FROM schedule_owners so
       LEFT JOIN users u ON u.id = so.user_id
      WHERE so.schedule_id = ANY($1::int[])
        AND (so.user_id IS NULL OR (u.account_state = 'active' AND u.anonymized_at IS NULL))`,
    [ids],
  );
  for (const row of ownerRows as Record<string, unknown>[]) {
    const owner = serializeOwner(row);
    const list = ownersByScheduleId.get(owner.scheduleId) ?? [];
    list.push(owner);
    ownersByScheduleId.set(owner.scheduleId, list);
  }
  return ownersByScheduleId;
}

/**
 * Full unfiltered listing for SCHEDULE_MANAGE holders — the Manage Schedule
 * table's data source. listScheduleForAudiences also includes draft/hidden
 * items for any staff caller now (H59 follow-up); this one exists separately
 * because SCHEDULE_MANAGE is the write capability, so it's the natural place
 * for bulk-management concerns, not because it sees more than staff do.
 */
export async function listSchedule() {
  const { rows } = await pool.query(
    `SELECT ${SCHEDULE_COLUMNS}
       FROM schedule
      ORDER BY starts_at ASC, id ASC`,
  );
  const ownersByScheduleId = await loadOwnersByScheduleId(rows.map((r) => Number(r.id)));
  return {
    items: rows.map((row) => ({
      ...serialize(row),
      owners: ownersByScheduleId.get(Number(row.id)) ?? [],
    })),
  };
}

export async function createScheduleItem(actorId: number | null, input: ScheduleInput) {
  assertWindow(input.startsAt, input.endsAt);
  const requiresScan = isMealActivityKind(input.type) || input.requiresScan === true;
  const audiences = input.audiences ?? [];
  assertScanRequiresParticipantAudience(requiresScan, audiences);
  const { visibility, publishAt } = normalizeVisibilityForAudiences(
    { visibility: input.visibility, publishAt: input.publishAt ?? null },
    audiences,
  );
  // The author's own account language, not a picker — see the module doc
  // comment above ScheduleTranslation.
  const primaryLanguage = actorId == null ? "es" : await getUserLanguage(actorId);
  const item = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO schedule
         (title, description, location, type, requires_scan, starts_at, ends_at, visibility, publish_at, audiences, contact_note, notes, primary_language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${SCHEDULE_COLUMNS}`,
      [
        input.title,
        input.description ?? null,
        input.location ?? null,
        input.type ?? null,
        requiresScan,
        input.startsAt,
        input.endsAt,
        visibility,
        publishAt,
        audiences,
        input.contactNote ?? null,
        input.notes ?? null,
        primaryLanguage,
      ],
    );
    const item = serialize(rows[0]);
    await client.query(
      `INSERT INTO activities (name, description, category, requires_scan, schedule_id, primary_language)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        item.title,
        item.description,
        toActivityCategory(item.type),
        item.requiresScan,
        item.id,
        item.primaryLanguage,
      ],
    );
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
  return autoTranslateOnCreate(actorId, item);
}

/**
 * Best-effort auto-translate a freshly created item's title/description into
 * every non-primary UI locale — this is what makes translation happen
 * automatically for the manage table's quick "New item" row, which has no UI
 * of its own for translations. Every locale on a new item starts blank, so
 * this can never clobber anything; a provider hiccup (or none configured)
 * just leaves the item exactly as created, no error surfaced.
 */
async function autoTranslateOnCreate(actorId: number | null, item: ReturnType<typeof serialize>) {
  if (!isTranslationAvailable() || !item.title.trim()) return item;
  try {
    return await translateScheduleContent(
      { title: item.title, description: item.description },
      ALL_LANGUAGES.filter((language) => language !== item.primaryLanguage),
    ).then((translations) => saveScheduleTranslations(actorId, item.id, translations));
  } catch {
    return item;
  }
}

/**
 * Re-anchors primary_language to the editor's own account language whenever
 * they submit a title (the full edit form always resolves/edits `title` in
 * the *viewer's* language now — see docs/notifications.md). The previous
 * primary language's canonical text is preserved as a regular translation
 * entry rather than lost; whatever text is about to become canonical is
 * dropped from the i18n map so it isn't duplicated in both places. A no-op
 * when the editor's language already matches, or when `patch.title` is
 * absent (a partial edit — reschedule, audience toggle — never touches
 * language anchoring).
 */
function reanchorPrimaryLanguage(
  current: Record<string, unknown>,
  actorLanguage: Language | null,
  patchHasTitle: boolean,
): {
  primaryLanguage: Language;
  titleI18n: Record<string, string>;
  descriptionI18n: Record<string, string | null>;
} {
  const oldPrimary = current.primary_language as Language;
  const titleI18n = { ...((current.title_i18n as Record<string, string> | null) ?? {}) };
  const descriptionI18n = {
    ...((current.description_i18n as Record<string, string | null> | null) ?? {}),
  };
  if (!patchHasTitle || actorLanguage === null || actorLanguage === oldPrimary) {
    return { primaryLanguage: oldPrimary, titleI18n, descriptionI18n };
  }
  titleI18n[oldPrimary] = current.title as string;
  descriptionI18n[oldPrimary] = (current.description as string | null) ?? null;
  delete titleI18n[actorLanguage];
  delete descriptionI18n[actorLanguage];
  return { primaryLanguage: actorLanguage, titleI18n, descriptionI18n };
}

export async function updateScheduleItem(actorId: number | null, id: number, patch: SchedulePatch) {
  const actorLanguage = actorId == null ? null : await getUserLanguage(actorId);
  const item = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM schedule WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0]) throw new NotFoundError("Schedule item not found", { id });
    const before = serialize(current.rows[0]);
    const nextStartsAt = patch.startsAt ?? (current.rows[0].starts_at as Date);
    const nextEndsAt = patch.endsAt ?? (current.rows[0].ends_at as Date);
    const nextType =
      patch.type === undefined ? (current.rows[0].type as string | null) : patch.type;
    const nextRequiresScan =
      isMealActivityKind(nextType) ||
      patch.requiresScan === true ||
      (patch.requiresScan === undefined && Boolean(current.rows[0].requires_scan));
    const nextAudiences = patch.audiences ?? (current.rows[0].audiences as string[]);
    assertWindow(nextStartsAt, nextEndsAt);
    assertScanRequiresParticipantAudience(nextRequiresScan, nextAudiences);
    const { visibility: nextVisibility, publishAt: nextPublishAt } = clearSpentPublishAt(
      normalizeVisibilityForAudiences(
        {
          visibility: patch.visibility ?? (current.rows[0].visibility as "shown" | "hidden"),
          publishAt: patch.publishAt === undefined ? current.rows[0].publish_at : patch.publishAt,
        },
        nextAudiences,
      ),
    );
    const {
      primaryLanguage: nextPrimaryLanguage,
      titleI18n: nextTitleI18n,
      descriptionI18n: nextDescriptionI18n,
    } = reanchorPrimaryLanguage(current.rows[0], actorLanguage, patch.title !== undefined);

    const { rows } = await client.query(
      `UPDATE schedule
          SET title = $2,
              description = $3,
              location = $4,
              type = $5,
              requires_scan = $6,
              starts_at = $7,
              ends_at = $8,
              visibility = $9,
              publish_at = $10,
              audiences = $11,
              contact_note = $12,
              notes = $13,
              primary_language = $14,
              title_i18n = $15,
              description_i18n = $16
        WHERE id = $1
        RETURNING ${SCHEDULE_COLUMNS}`,
      [
        id,
        patch.title ?? current.rows[0].title,
        patch.description === undefined ? current.rows[0].description : patch.description,
        patch.location === undefined ? current.rows[0].location : patch.location,
        nextType,
        nextRequiresScan,
        nextStartsAt,
        nextEndsAt,
        nextVisibility,
        nextPublishAt,
        nextAudiences,
        patch.contactNote === undefined ? current.rows[0].contact_note : patch.contactNote,
        patch.notes === undefined ? current.rows[0].notes : patch.notes,
        nextPrimaryLanguage,
        nextTitleI18n,
        nextDescriptionI18n,
      ],
    );
    const after = serialize(rows[0]);
    await client.query(
      `UPDATE activities
          SET name = $2,
              description = $3,
              category = $4,
              requires_scan = $5,
              primary_language = $6,
              name_i18n = $7,
              description_i18n = $8
        WHERE schedule_id = $1`,
      [
        id,
        after.title,
        after.description,
        toActivityCategory(after.type),
        after.requiresScan,
        after.primaryLanguage,
        after.titleI18n,
        after.descriptionI18n,
      ],
    );
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
    // H25/H26: keep historical scan logs, but remove the linked activity from
    // scanner pickers before the foreign key clears its schedule reference.
    await client.query(
      `UPDATE activities SET category = 'archived', requires_scan = false WHERE schedule_id = $1`,
      [id],
    );
    const { rows } = await client.query(
      `DELETE FROM schedule
        WHERE id = $1
        RETURNING ${SCHEDULE_COLUMNS}`,
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

/**
 * Merges translations into title_i18n/description_i18n (each locale entry
 * merged independently, so redoing English doesn't touch a manually-edited
 * Galician entry) and mirrors the result onto the linked activity row, same
 * as title/description already are in updateScheduleItem. Used both by the
 * manual "edit a translation" flow and by translateScheduleItem below.
 */
export async function saveScheduleTranslations(
  actorId: number | null,
  id: number,
  translations: ScheduleTranslations,
) {
  const item = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT ${SCHEDULE_COLUMNS} FROM schedule WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0]) throw new NotFoundError("Schedule item not found", { id });
    const before = serialize(current.rows[0]);
    const nextTitleI18n = { ...before.titleI18n } as Record<string, string>;
    const nextDescriptionI18n = { ...before.descriptionI18n } as Record<string, string | null>;
    for (const [lang, translation] of Object.entries(translations) as [
      Language,
      ScheduleTranslation,
    ][]) {
      if (translation.title !== undefined) nextTitleI18n[lang] = translation.title;
      if (translation.description !== undefined)
        nextDescriptionI18n[lang] = translation.description;
    }
    const { rows } = await client.query(
      `UPDATE schedule SET title_i18n = $2, description_i18n = $3
        WHERE id = $1
        RETURNING ${SCHEDULE_COLUMNS}`,
      [id, nextTitleI18n, nextDescriptionI18n],
    );
    const after = serialize(rows[0]);
    await client.query(
      `UPDATE activities SET name_i18n = $2, description_i18n = $3 WHERE schedule_id = $1`,
      [id, after.titleI18n, after.descriptionI18n],
    );
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: id,
      action: "update_translations",
      before: { titleI18n: before.titleI18n, descriptionI18n: before.descriptionI18n },
      after: { titleI18n: after.titleI18n, descriptionI18n: after.descriptionI18n },
    });
    return after;
  });
  await emitScheduleChanged({ action: "update", item });
  return item;
}

/**
 * Machine-translates arbitrary title+description content into `targets` via
 * the configured provider (H50's translate/ module), auto-detecting the
 * source language rather than trusting any stored/assumed one — staff can
 * type the primary content in whatever language actually comes naturally,
 * not just their account's. Pure: doesn't touch the database or require an
 * existing schedule item, so both the create and edit forms can call it
 * before (or instead of) saving. Callers are responsible for only requesting
 * targets that are actually still blank — this never "redoes" a locale that
 * already has translated text (mirrors announcements' "only fill languages
 * that are still empty" rule); saveScheduleTranslations persists whatever
 * comes back (or a hand-typed edit) unconditionally.
 */
export async function translateScheduleContent(
  content: { title: string; description?: string | null },
  targets: Language[],
): Promise<ScheduleTranslations> {
  const translated = await translateFields(
    { title: content.title, description: content.description ?? "" },
    "auto",
    targets,
  );
  const translations: ScheduleTranslations = {};
  for (const [lang, fields] of Object.entries(translated) as [
    Language,
    { title: string; description: string },
  ][]) {
    translations[lang] = { title: fields.title, description: fields.description || null };
  }
  return translations;
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
    // schedule_visibility_requires_audience (0720) rejects 'shown' on a
    // staff-only item — silently skip those rather than let a batch that
    // happens to include one fail the whole transaction; "hidden" is always
    // safe for every row.
    const { rows } = await client.query(
      visibility === "shown"
        ? `UPDATE schedule SET visibility = $2
            WHERE id = ANY($1::int[]) AND array_length(audiences, 1) > 0
          RETURNING id`
        : // Same spent-publish_at rule as updateScheduleItem: a due date left
          // over from an earlier reveal would have the publisher flip these
          // rows back to 'shown' on its next tick.
          `UPDATE schedule
              SET visibility = $2,
                  publish_at = CASE WHEN publish_at <= now() THEN NULL ELSE publish_at END
            WHERE id = ANY($1::int[])
          RETURNING id`,
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

/** Bulk "schedule these hidden items to reveal at once" (H59). */
export async function setScheduleBulkPublishAt(
  actorId: number | null,
  ids: number[],
  publishAt: Date | null,
) {
  const result = await withTransaction(async (client) => {
    const before = await client.query(
      `SELECT id, publish_at FROM schedule WHERE id = ANY($1::int[]) FOR UPDATE`,
      [ids],
    );
    // schedule_visibility_requires_audience (0720) rejects a non-null
    // publish_at on a staff-only item (nothing tagged is waiting on a
    // reveal) — silently skip those; clearing (publishAt: null) is always
    // safe for every row.
    const { rows } = await client.query(
      publishAt !== null
        ? `UPDATE schedule SET publish_at = $2
            WHERE id = ANY($1::int[]) AND array_length(audiences, 1) > 0
          RETURNING id`
        : `UPDATE schedule SET publish_at = $2 WHERE id = ANY($1::int[]) RETURNING id`,
      [ids, publishAt],
    );
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: `batch:publish_at`,
      action: "set_publish_at",
      before: { rows: before.rows },
      after: { ids, publishAt, updated: rows.length },
    });
    return {
      ids: rows.map((r: { id: number }) => r.id),
      publishAt: publishAt ? publishAt.toISOString() : null,
      updated: rows.length,
    };
  });
  await emitScheduleChanged({ action: "set_publish_at", ...result });
  return result;
}

// ── H59: responsible person(s) ("owners") for a schedule item ──────────
// Modeled on the `sponsors` (enterprise members) join table, not
// `enterprise_judges` — a flat resource-to-users link, not scoped to a
// compound resource.

/**
 * One row can be either a real account (`userId` set, name/surname/email
 * from `users`) or a free-text name (`freeTextName` set, no account behind
 * it — an external vendor, a volunteer without a login) — never both,
 * enforced by schedule_owners_exactly_one_identity (0719).
 */
export interface ScheduleOwner {
  id: number;
  scheduleId: number;
  userId: number | null;
  name: string | null;
  surname: string | null;
  email: string | null;
  freeTextName: string | null;
  assignedAt: string;
}

function serializeOwner(row: Record<string, unknown>): ScheduleOwner {
  return {
    id: Number(row.id),
    scheduleId: Number(row.schedule_id),
    userId: row.user_id == null ? null : Number(row.user_id),
    name: (row.name as string | null) ?? null,
    surname: (row.surname as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    freeTextName: (row.free_text_name as string | null) ?? null,
    assignedAt: (row.assigned_at as Date).toISOString(),
  };
}

export interface OwnerCandidate {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

/**
 * Minimal account lookup for assigning a schedule item's responsible
 * person(s) (H59) — gated by SCHEDULE_MANAGE (the same capability that
 * governs the write), not the broad USERS_READ, mirroring
 * projects/service.ts's listProjectMemberCandidates. Someone who can manage
 * the programme but isn't a general user-directory admin should still be
 * able to pick a colleague.
 */
export async function listScheduleOwnerCandidates(
  query: string,
  limit: number,
): Promise<OwnerCandidate[]> {
  const filter = `%${query.trim()}%`;
  const { rows } = await pool.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE account_state = 'active' AND anonymized_at IS NULL
        AND (email ILIKE $1 OR name ILIKE $1 OR surname ILIKE $1)
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT $2`,
    [filter, limit],
  );
  return rows;
}

export async function listScheduleOwners(scheduleId: number): Promise<ScheduleOwner[]> {
  const { rows } = await pool.query(
    `SELECT so.id, so.schedule_id, so.user_id, u.name, u.surname, u.email,
            so.free_text_name, so.assigned_at
      FROM schedule_owners so
       LEFT JOIN users u ON u.id = so.user_id
      WHERE so.schedule_id = $1
        AND (so.user_id IS NULL OR (u.account_state = 'active' AND u.anonymized_at IS NULL))
      ORDER BY COALESCE(u.name, so.free_text_name) NULLS LAST, u.email`,
    [scheduleId],
  );
  return rows.map(serializeOwner);
}

/**
 * Either `userId` (a real account) or `freeTextName` (an external name with
 * no login) — exactly one, matching schedule_owners_exactly_one_identity.
 */
export type ScheduleOwnerInput = { userId: number } | { freeTextName: string };

export async function addScheduleOwner(
  actorId: number | null,
  scheduleId: number,
  input: ScheduleOwnerInput,
): Promise<ScheduleOwner> {
  const { rows: scheduleRows } = await pool.query(`SELECT id FROM schedule WHERE id = $1`, [
    scheduleId,
  ]);
  if (!scheduleRows[0]) throw new NotFoundError("Schedule item not found", { scheduleId });

  if ("userId" in input) {
    const { userId } = input;
    const { rows: userRows } = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found", { userId });

    const { rows: existing } = await pool.query(
      `SELECT id FROM schedule_owners WHERE schedule_id = $1 AND user_id = $2`,
      [scheduleId, userId],
    );
    if (existing[0]) {
      throw new ConflictError("User is already an owner of this schedule item", {
        scheduleId,
        userId,
      });
    }

    return withTransaction(async (client) => {
      const { rows: activeUserRows } = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR SHARE`,
        [userId],
      );
      if (!activeUserRows[0]) throw new NotFoundError("User not found", { userId });
      const { rows } = await client.query(
        `INSERT INTO schedule_owners (schedule_id, user_id, assigned_by)
         VALUES ($1, $2, $3)
         RETURNING id, schedule_id, user_id, assigned_at`,
        [scheduleId, userId, actorId],
      );
      const { rows: userRow } = await client.query(
        `SELECT name, surname, email FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
        [userId],
      );
      const owner = serializeOwner({ ...rows[0], ...userRow[0] });
      await audit(client, {
        actorId,
        entityType: "schedule_owner",
        entityId: `${scheduleId}:${owner.id}`,
        action: "create",
        after: owner,
      });
      return owner;
    });
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO schedule_owners (schedule_id, free_text_name, assigned_by)
       VALUES ($1, $2, $3)
       RETURNING id, schedule_id, free_text_name, assigned_at`,
      [scheduleId, input.freeTextName, actorId],
    );
    const owner = serializeOwner(rows[0]);
    await audit(client, {
      actorId,
      entityType: "schedule_owner",
      entityId: `${scheduleId}:${owner.id}`,
      action: "create",
      after: owner,
    });
    return owner;
  });
}

export async function removeScheduleOwner(
  actorId: number | null,
  scheduleId: number,
  ownerId: number,
): Promise<void> {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM schedule_owners WHERE schedule_id = $1 AND id = $2`,
      [scheduleId, ownerId],
    );
    if (!rowCount) {
      throw new NotFoundError("Owner not found on this schedule item", {
        scheduleId,
        ownerId,
      });
    }
    await audit(client, {
      actorId,
      entityType: "schedule_owner",
      entityId: `${scheduleId}:${ownerId}`,
      action: "delete",
    });
  });
}

// ── H59: audience-aware read feed ───────────────────────────────────────
// One feed backs the public site, the staff management table, and the
// sponsor hub — the caller's audience is computed server-side and used to
// filter which live items come back, rather than parallel endpoints running
// variants of the same query.

export interface CallerScheduleAudience {
  /** Sees every live item unconditionally, plus owners/contactNote/notes on all of them. */
  isStaff: boolean;
  /** `sponsor`/`participant`/`mentor` — the optional per-item toggles that apply to this caller. */
  audiences: Set<ScheduleAudience>;
}

/**
 * Staff (any authenticated account holding at least one capability) always
 * sees everything — never gated by the stored `audiences` set. Everyone else
 * is resolved to at most one attendee audience (`participant`/`mentor`,
 * mutually exclusive) plus `sponsor` if they're a linked sponsor rep. An
 * anonymous caller (no session — the public site/TV) is treated as
 * `participant`: there's no audience distinct from "what participants see"
 * for an anonymous visitor (H59).
 */
export async function callerScheduleAudiences(
  userId: number | null,
): Promise<CallerScheduleAudience> {
  if (userId == null) return { isStaff: false, audiences: new Set(["participant"]) };
  const [capabilities, { isSponsorRep }, attendeeType] = await Promise.all([
    getEffectiveCapabilities(userId),
    computeMembershipFlags(pool, userId),
    mentorOrParticipantType(pool, userId),
  ]);
  if (capabilities.size > 0) return { isStaff: true, audiences: new Set() };
  const audiences = new Set<ScheduleAudience>();
  // A sponsor rep always sees the entire public schedule (the same
  // `participant` feed anyone else browses), plus their own sponsor-tagged
  // content on top — sponsor is additive, never a narrower view (H59).
  if (isSponsorRep) audiences.add("sponsor").add("participant");
  if (attendeeType) audiences.add(attendeeType);
  return { isStaff: false, audiences };
}

export interface AudienceScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
  publishAt: string | null;
  audiences: string[];
  /** Only populated when the caller shares a non-public audience with this item. */
  contactNote?: string | null;
  owners?: {
    id: number;
    userId: number | null;
    name: string | null;
    surname: string | null;
    freeTextName: string | null;
  }[];
  /** Staff-only free-form notes (the escaleta's "Observaciones"). */
  notes?: string | null;
  /** Staff-only — lets a staff client tell a draft/hidden item apart from a live one. */
  visibility?: "shown" | "hidden";
  /** Language `title`/`description` are authored in — every viewer gets this, to resolve their own fallback (English, then this). */
  primaryLanguage: Language;
  titleI18n: Record<string, string>;
  descriptionI18n: Record<string, string | null>;
}

export async function listScheduleForAudiences(
  caller: CallerScheduleAudience,
): Promise<AudienceScheduleItem[]> {
  // Staff run the whole show, not just staff-tagged items, and not only the
  // *live* run-of-show either — an item still in draft (visibility='hidden')
  // or scheduled to reveal later is exactly what staff need to see and
  // prep, while it must stay invisible to everyone else (H59 follow-up: a
  // draft's own audience checkboxes shouldn't force staff to publish it just
  // to preview it on the run-of-show).
  const { rows } = await pool.query(
    `SELECT id, title, description, location, type, starts_at, ends_at, publish_at,
            audiences, contact_note, notes, visibility, primary_language, title_i18n, description_i18n
       FROM schedule
      WHERE $2
         OR (
           visibility = 'shown'
           AND (publish_at IS NULL OR publish_at <= now())
           AND audiences && $1::text[]
         )
      ORDER BY starts_at ASC, id ASC`,
    [Array.from(caller.audiences), caller.isStaff],
  );
  const ids = rows.map((r: Record<string, unknown>) => Number(r.id));
  const ownersByScheduleId = await loadOwnersByScheduleId(ids);

  return rows.map((row: Record<string, unknown>) => {
    const itemAudiences = new Set((row.audiences as string[]) ?? []);
    const sharesSponsorAudience = itemAudiences.has("sponsor") && caller.audiences.has("sponsor");
    const base = {
      id: Number(row.id),
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      location: (row.location as string | null) ?? null,
      type: (row.type as string | null) ?? null,
      startsAt: (row.starts_at as Date).toISOString(),
      endsAt: (row.ends_at as Date).toISOString(),
      publishAt: row.publish_at instanceof Date ? row.publish_at.toISOString() : null,
      // Non-sensitive categorization metadata — always exposed so a sponsor
      // rep's client can pick out "sponsor-relevant" items from the general
      // feed (H59), same as it already lets a staff caller do the same.
      audiences: Array.from(itemAudiences),
      primaryLanguage: ((row.primary_language as Language | null) ?? "es") as Language,
      titleI18n: (row.title_i18n as Record<string, string> | null) ?? {},
      descriptionI18n: (row.description_i18n as Record<string, string | null> | null) ?? {},
    };
    // Staff sees owners/contact/notes for every item, regardless of that
    // item's own audience tags — operational detail is a staff concern, not
    // gated by who the content is themed for. A sponsor rep only gets
    // owners/contact for items explicitly tagged `sponsor`, and never the
    // (staff-internal) notes.
    if (!caller.isStaff && !sharesSponsorAudience) return base;
    return {
      ...base,
      contactNote: (row.contact_note as string | null) ?? null,
      owners: (ownersByScheduleId.get(Number(row.id)) ?? []).map((o) => ({
        id: o.id,
        userId: o.userId,
        name: o.name,
        surname: o.surname,
        freeTextName: o.freeTextName,
      })),
      ...(caller.isStaff
        ? {
            notes: (row.notes as string | null) ?? null,
            visibility: row.visibility as "shown" | "hidden",
          }
        : {}),
    };
  });
}
