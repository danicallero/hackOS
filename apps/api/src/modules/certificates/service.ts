import { createHash, randomBytes } from "node:crypto";
import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type pg from "pg";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit, auditMany } from "../../lib/audit.js";
import { recordsToCsv, toCsv } from "../../lib/csv.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors.js";
import { stampCopyFooter } from "../../lib/pdf-copy-footer.js";
import { userUniversityIdSql } from "../../lib/user-university.js";
import { hasEventAccess } from "../identity/role.js";
import { allHours, userHours } from "../logistics/presence.js";
import { assertFixtureSubjectScope, fixtureReadFilter } from "../logistics/review-fixture-scope.js";
import {
  type CertificateLocale,
  type CertificateSnapshot,
  type CertificateVariant,
  renderCertificatePdf,
  statesHours,
} from "./pdf.js";
import {
  activeRoleIds,
  assertTypeRecipient,
  type CertificateType,
  isExemptRecipient,
  listCertificateTypes,
  readCertificateType,
  recipientMatchesType,
} from "./types.js";

/** #1083: the organisation-wide certificate policy (one row). */
export interface CertificateSettings {
  /** Verified venue hours needed for automatic issue; null switches it off. */
  minHours: number | null;
  minReviewHours: number | null;
  awardHours: number | null;
  issuerName: string;
}

export async function readSettings(
  db: pg.Pool | pg.PoolClient = pool,
): Promise<CertificateSettings> {
  const { rows } = await db.query(
    `SELECT min_hours, min_review_hours, award_hours, issuer_name FROM certificate_settings WHERE id = 1`,
  );
  const row = rows[0];
  return {
    minHours: row.min_hours == null ? null : Number(row.min_hours),
    minReviewHours: row.min_review_hours == null ? null : Number(row.min_review_hours),
    awardHours: row.award_hours == null ? null : Number(row.award_hours),
    issuerName: row.issuer_name,
  };
}

export async function updateSettings(
  actorId: number,
  patch: Partial<CertificateSettings>,
): Promise<CertificateSettings> {
  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM certificate_settings WHERE id = 1 FOR UPDATE`);
    const before = await readSettings(client);
    const next = { ...before, ...patch };
    if (
      next.minHours != null &&
      next.minReviewHours != null &&
      next.minReviewHours > next.minHours
    ) {
      throw new BadRequestError("The review threshold must not exceed the automatic threshold");
    }
    await client.query(
      `UPDATE certificate_settings SET min_hours = $1, issuer_name = $2, min_review_hours = $3, award_hours = $4 WHERE id = 1`,
      [next.minHours, next.issuerName, next.minReviewHours, next.awardHours],
    );
    if (next.awardHours !== before.awardHours) {
      const { rows } = await client.query(
        `UPDATE attendance_certificates
        SET revoked_at=now(), revoked_by=$1, revoked_reason='certificate_award_policy_changed'
        WHERE revoked_at IS NULL AND snapshot->>'attendancePolicy' IS DISTINCT FROM 'false' AND snapshot->>'manuallyCertified' IS DISTINCT FROM 'true' RETURNING id`,
        [actorId],
      );
      await auditMany(
        client,
        rows.map((row) => ({
          actorId,
          entityType: "attendance_certificate",
          entityId: row.id,
          action: "certificate.revoke",
          reason: "certificate_award_policy_changed",
        })),
      );
    }
    await audit(client, {
      actorId,
      entityType: "certificate_settings",
      entityId: 1,
      action: "certificate_settings.update",
      before,
      after: next,
    });
    return next;
  });
}

export type EligibilityReason = "not_available" | "hours_not_met" | "review_required";

/** Why a type cannot be issued to this person now, beyond the shared hours policy. */
export type GateReason =
  | EligibilityReason
  | "event_not_ended"
  | "demo_required"
  | "demo_jury_required";

export interface Eligibility {
  hours: number;
  certifiedHours: number | null;
  reviewRequired: boolean;
  approval: CertificateApproval | null;
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: EligibilityReason | null;
}

export interface CertificateApproval {
  certifiedHours: number;
  reason: string;
  approvedBy: number | null;
  approvedAt: string;
}

async function readApproval(
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
): Promise<CertificateApproval | null> {
  const { rows } = await db.query(
    `SELECT certified_hours, reason, approved_by, approved_at FROM certificate_approvals WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  return row
    ? {
        certifiedHours: Number(row.certified_hours),
        reason: row.reason,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at.toISOString(),
      }
    : null;
}

function evaluate(
  settings: CertificateSettings,
  hours: number,
  approval: CertificateApproval | null = null,
): Eligibility {
  let reason: EligibilityReason | null = null;
  const reviewRequired =
    !approval && settings.minReviewHours != null && hours > 0 && hours >= settings.minReviewHours;
  if (!approval) {
    if (settings.minHours == null) reason = "not_available";
    else if (hours < settings.minHours || hours <= 0) reason = "hours_not_met";
    if (reason && reviewRequired) reason = "review_required";
  }
  return {
    hours,
    eligible: reason === null,
    reason,
    reviewRequired: reason === "review_required",
    certifiedHours:
      approval?.certifiedHours ?? (reason === null ? (settings.awardHours ?? hours) : null),
    approval,
  };
}

/** #1083: serialize review decisions, issue and account removal on the subject. */
async function lockPerson(client: pg.PoolClient, userId: number) {
  const { rows } = await client.query(
    `SELECT id FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
}

async function recordApproval(
  client: pg.PoolClient,
  actorId: number,
  userId: number,
  certifiedHours: number,
  reason: string,
) {
  const before = await readApproval(userId, client);
  await client.query(
    `INSERT INTO certificate_approvals(user_id, certified_hours, reason, approved_by)
    VALUES ($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET certified_hours=$2, reason=$3, approved_by=$4, approved_at=now()`,
    [userId, certifiedHours, reason, actorId],
  );
  // An existing public code must never verify a different award after a review.
  const { rows } = await client.query(
    `UPDATE attendance_certificates SET revoked_at=now(), revoked_by=$2, revoked_reason='certified_hours_reviewed'
    WHERE user_id=$1 AND revoked_at IS NULL AND snapshot->>'attendancePolicy' IS DISTINCT FROM 'false' AND ((snapshot->>'hours')::numeric IS DISTINCT FROM $3::numeric OR snapshot->>'manuallyCertified' IS DISTINCT FROM 'true') RETURNING id`,
    [userId, actorId, certifiedHours],
  );
  await auditMany(
    client,
    rows.map((row) => ({
      actorId,
      entityType: "attendance_certificate",
      entityId: row.id,
      action: "certificate.revoke",
      reason: "certified_hours_reviewed",
    })),
  );
  await audit(client, {
    actorId,
    entityType: "certificate_approval",
    entityId: userId,
    action: "certificate.approve",
    before,
    after: { userId, certifiedHours },
    reason,
  });
}

export async function approveCertificateHours(
  actorId: number,
  userId: number,
  certifiedHours: number,
  reason: string,
): Promise<Eligibility> {
  await withTransaction(async (client) => {
    await assertFixtureSubjectScope(client, actorId, userId);
    await lockPerson(client, userId);
    await recordApproval(client, actorId, userId, certifiedHours, reason);
  });
  return eligibilityFor(userId);
}

/** What the person's team has presented: any jury, a mandatory challenge, or these challenges. */
interface Presentations {
  any: boolean;
  mandatory: boolean;
  challengeIds: Set<number>;
}

/** Teams that presented: their queue entry started or finished a presentation, per person. */
async function presentationsFor(
  userIds: number[],
  db: pg.Pool | pg.PoolClient = pool,
): Promise<Map<number, Presentations>> {
  const { rows } = await db.query<{ user_id: number; challenge_id: number; mandatory: boolean }>(
    `SELECT DISTINCT s.user_id, q.challenge_id, c.mandatory
       FROM submissions s
       JOIN queue_entries q ON q.repo_id = s.repo_id
       JOIN challenges c ON c.id = q.challenge_id
      WHERE s.status = 'active' AND s.user_id = ANY($1::int[])
        AND (q.completed_at IS NOT NULL OR q.presentation_started_at IS NOT NULL)`,
    [userIds],
  );
  const result = new Map<number, Presentations>();
  for (const row of rows) {
    let entry = result.get(row.user_id);
    if (!entry) {
      entry = { any: true, mandatory: false, challengeIds: new Set() };
      result.set(row.user_id, entry);
    }
    entry.mandatory ||= row.mandatory;
    entry.challengeIds.add(row.challenge_id);
  }
  return result;
}

const NO_PRESENTATIONS = (): Presentations => ({
  any: false,
  mandatory: false,
  challengeIds: new Set(),
});

async function presentationsOf(
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
): Promise<Presentations> {
  return (await presentationsFor([userId], db)).get(userId) ?? NO_PRESENTATIONS();
}

/** Facts typeGate would otherwise query, preloaded for a whole batch. */
interface GateFacts {
  eventEndsAt: Date | null;
  presented: Presentations;
}

/**
 * Requirements a type adds to the shared hours policy, for someone who is not
 * exempt: wait for the event to end, then presenting to the required jury. A
 * manual award (staff decided) stands in for the presentation, not for the wait.
 */
async function typeGate(
  definition: CertificateType,
  userId: number,
  db: pg.Pool | pg.PoolClient,
  approved: boolean,
  facts?: GateFacts,
): Promise<GateReason | null> {
  if (definition.requiresEventEnd) {
    const ends = facts
      ? facts.eventEndsAt
      : ((await db.query(`SELECT event_ends_at FROM event_config WHERE id = 1`)).rows[0]
          ?.event_ends_at as Date | null | undefined);
    if (!ends || ends.getTime() > Date.now()) return "event_not_ended";
  }
  if (definition.demoRequirement === "none" || approved) return null;
  const presented = facts?.presented ?? (await presentationsOf(userId, db));
  if (definition.demoRequirement === "any") return presented.any ? null : "demo_required";
  const met =
    definition.demoRequirement === "mandatory"
      ? presented.mandatory
      : definition.demoChallengeId != null &&
        presented.challengeIds.has(definition.demoChallengeId);
  return met ? null : "demo_jury_required";
}

export async function eligibilityFor(userId: number): Promise<Eligibility> {
  const [settings, { hours }, approval] = await Promise.all([
    readSettings(),
    userHours(userId, undefined, undefined, { verifiedOnly: true }),
    readApproval(userId),
  ]);
  return evaluate(settings, hours, approval);
}

function reasonError(reason: GateReason): ConflictError {
  if (reason === "event_not_ended")
    return new ConflictError("This certificate is available once the event has ended", {
      code: ERROR_REASONS.CERTIFICATE_EVENT_NOT_ENDED,
    });
  if (reason === "demo_jury_required")
    return new ConflictError("This certificate requires having presented to the required jury", {
      code: ERROR_REASONS.CERTIFICATE_DEMO_JURY_REQUIRED,
    });
  if (reason === "review_required")
    return new ConflictError("Your attendance is awaiting staff review", {
      code: ERROR_REASONS.CERTIFICATE_REVIEW_REQUIRED,
    });
  if (reason === "demo_required") {
    return new ConflictError("This certificate requires having presented a project", {
      code: ERROR_REASONS.CERTIFICATE_DEMO_REQUIRED,
    });
  }
  return new ConflictError(
    reason === "hours_not_met"
      ? "Not enough verified venue hours for a certificate"
      : "Certificates are not available yet",
    {
      code:
        reason === "hours_not_met"
          ? ERROR_REASONS.CERTIFICATE_HOURS_NOT_MET
          : ERROR_REASONS.CERTIFICATE_NOT_AVAILABLE,
    },
  );
}

async function buildSnapshot(
  db: pg.Pool | pg.PoolClient,
  userId: number | null,
  locale: CertificateLocale,
  hours: number,
  issuerName: string,
  guestName?: string,
  preloaded?: { person: Record<string, unknown>; activities: { name: string; at: string }[] },
): Promise<CertificateSnapshot> {
  const { rows: people } = preloaded
    ? { rows: [preloaded.person] }
    : userId == null
      ? await db.query(
          `SELECT $1::text AS name, NULL::text AS surname, name AS event_name, venue_name, timezone, event_starts_at, event_ends_at FROM event_config WHERE id=1`,
          [guestName],
        )
      : await db.query(
          `SELECT u.name, u.surname, c.name AS event_name, c.venue_name, c.timezone,
            c.event_starts_at, c.event_ends_at
       FROM users u CROSS JOIN event_config c
      WHERE u.id = $1 AND c.id = 1
        AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
          [userId],
        );
  const person = people[0];
  if (!person) throw new NotFoundError("User not found");
  if (!person.event_starts_at || !person.event_ends_at) {
    throw new ConflictError("The event dates are not set", {
      code: ERROR_REASONS.CERTIFICATE_NOT_AVAILABLE,
    });
  }
  const activities = preloaded?.activities ?? (await attendedActivities(db, userId, locale));
  return {
    name: person.name ?? "",
    surname: person.surname ?? null,
    eventName: person.event_name ?? "",
    venue: person.venue_name ?? null,
    timezone: person.timezone,
    eventStartsAt: (person.event_starts_at as Date).toISOString(),
    eventEndsAt: (person.event_ends_at as Date).toISOString(),
    issuerName,
    hours,
    activities,
  };
}

export interface CertificateRow {
  id: number;
  code: string;
  userId: number | null;
  typeId: number;
  typeName: string | null;
  recipientName: string;
  activityName: string;
  variant: CertificateVariant;
  locale: CertificateLocale;
  source: "self" | "bulk" | "staff";
  overrideReason: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  /** Replaced by a newer certificate; still valid as issued. */
  supersededAt: string | null;
  /** Attendance changed since this one was issued (only computed when listing a person's documents). */
  outdated: boolean;
}

function toRow(row: Record<string, unknown>): CertificateRow {
  return {
    id: row.id as number,
    code: row.code as string,
    userId: row.user_id as number | null,
    typeId: row.type_id as number,
    typeName: row.type_name as string | null,
    recipientName: row.recipient_name_display as string,
    activityName: row.activity_name as string,
    variant: row.variant as CertificateVariant,
    locale: row.locale as CertificateLocale,
    source: row.source as CertificateRow["source"],
    overrideReason: (row.override_reason as string | null) ?? null,
    issuedAt: (row.issued_at as Date).toISOString(),
    revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
    revokedReason: (row.revoked_reason as string | null) ?? null,
    supersededAt: row.superseded_at ? (row.superseded_at as Date).toISOString() : null,
    outdated: false,
  };
}

const COLUMNS = `id, code, user_id, type_id, snapshot->>'typeName' AS type_name,
                 COALESCE(snapshot->>'name','') || COALESCE(' ' || (snapshot->>'surname'),'') AS recipient_name_display, activity_name, variant, locale, source, override_reason, issued_at,
                 revoked_at, revoked_reason, superseded_at`;

interface IssueOptions {
  userId: number | null;
  variant: CertificateVariant;
  typeId?: number;
  locale: CertificateLocale;
  source: "self" | "bulk" | "staff";
  actorId: number | null;
  overrideReason?: string | null;
  hours: number;
  approval?: { certifiedHours: number; reason: string };
  guestName?: string;
  activityName?: string;
  documentKind?: "dni_nie" | "passport";
  documentNumber?: string;
  includeIdentification?: boolean;
  /** Replace the current certificate when what it states has changed. */
  refresh?: boolean;
  /** Batch reads shared by a bulk run; the locked rows are still re-read per person. */
  preloaded?: BulkRecipient;
}

/** Everything a bulk run reads once for one recipient instead of inside each transaction. */
interface BulkRecipient {
  definition: CertificateType;
  hours: number;
  matchesAudience: boolean;
  exempt: boolean;
  dni: string | null;
  person: Record<string, unknown>;
  activities: { name: string; at: string }[];
  gate: GateFacts;
}

/** What a legacy attendance variant states: hours for `hours`, the list for `activities`. */
function sameStatedFacts(
  before: Partial<CertificateSnapshot>,
  after: CertificateSnapshot,
  variant: CertificateVariant,
): boolean {
  if (variant === "hours") return Number(before.hours) === after.hours;
  if (variant === "activities")
    return (
      JSON.stringify((before.activities ?? []).map((a) => a.name)) ===
      JSON.stringify(after.activities.map((a) => a.name))
    );
  return true;
}

/** Non-meal activities the person has a scan for, named in the document's language. */
async function attendedActivities(
  db: pg.Pool | pg.PoolClient,
  userId: number | null,
  locale: CertificateLocale,
): Promise<{ name: string; at: string }[]> {
  if (userId == null) return [];
  return (await attendedActivitiesFor(db, [userId], locale)).get(userId) ?? [];
}

/** The same lists for many people in one query. */
async function attendedActivitiesFor(
  db: pg.Pool | pg.PoolClient,
  userIds: number[],
  locale: CertificateLocale,
): Promise<Map<number, { name: string; at: string }[]>> {
  // Meals are not activities a certificate should list.
  const { rows } = await db.query(
    `SELECT l.user_id, COALESCE(a.name_i18n ->> $2, a.name) AS name, min(l.logged_at) AS at
       FROM activity_logs l JOIN activities a ON a.id = l.activity_id
      WHERE l.user_id = ANY($1::int[]) AND NOT (a.category = ANY($3::text[]))
      GROUP BY l.user_id, a.id, a.name, a.name_i18n
      ORDER BY l.user_id, min(l.logged_at), a.id`,
    [userIds, locale, [...MEAL_ACTIVITY_KINDS]],
  );
  const result = new Map<number, { name: string; at: string }[]>();
  for (const row of rows) {
    const list = result.get(row.user_id) ?? [];
    list.push({ name: String(row.name), at: (row.at as Date).toISOString() });
    result.set(row.user_id, list);
  }
  return result;
}

/**
 * Inserts the certificate, or returns the live one for the same person and
 * variant and language (the partial unique index makes concurrent requests converge).
 */
async function insertCertificate(
  opts: IssueOptions,
): Promise<CertificateRow & { created: boolean }> {
  return withTransaction(async (client) => {
    await client.query(`SELECT id FROM certificate_settings WHERE id=1 FOR SHARE`);
    const settings = await readSettings(client);
    let pre = opts.preloaded;
    let definition: CertificateType;
    if (pre) {
      // Lock the type row, and drop the preload if the type was edited since it was read.
      const { rows: locked } = await client.query(
        `SELECT revision FROM certificate_types WHERE id=$1 FOR SHARE`,
        [pre.definition.id],
      );
      if (locked[0]?.revision === pre.definition.revision) definition = pre.definition;
      else {
        pre = undefined;
        definition = await readCertificateType(opts.typeId, opts.variant, client, true);
      }
    } else {
      definition = await readCertificateType(opts.typeId, opts.variant, client, true);
    }
    if (!definition.enabled) throw new ConflictError("This certificate type is disabled");
    if (opts.userId != null) {
      await lockPerson(client, opts.userId);
      if (pre) {
        if (!pre.matchesAudience)
          throw new ForbiddenError("This certificate type is not available to this recipient");
      } else await assertTypeRecipient(definition, opts.userId, client, opts.source === "self");
    } else if (!definition.allowGuests || !opts.guestName?.trim()) {
      throw new BadRequestError("This certificate type does not accept guest recipients");
    }
    if (definition.requiresActivity && !opts.activityName?.trim())
      throw new BadRequestError("A talk or activity name is required");
    const { rows: identities } =
      opts.userId == null
        ? { rows: [] }
        : pre
          ? { rows: [{ dni: pre.dni }] }
          : await client.query(`SELECT dni FROM users WHERE id=$1`, [opts.userId]);
    if (
      definition.identityPolicy === "required" &&
      (opts.includeIdentification === false || !(opts.documentNumber?.trim() || identities[0]?.dni))
    )
      throw new BadRequestError("This certificate type requires identification");
    if (opts.includeIdentification === true && !(opts.documentNumber?.trim() || identities[0]?.dni))
      throw new BadRequestError("Identification was selected but no document number is available");
    if (opts.documentKind && !opts.documentNumber)
      throw new BadRequestError("A document type requires an explicit document number");
    if (
      (definition.identityPolicy === "none" || opts.includeIdentification === false) &&
      opts.documentNumber
    )
      throw new BadRequestError("This certificate type does not collect identification");
    if (opts.approval && opts.actorId != null && opts.userId != null)
      await recordApproval(
        client,
        opts.actorId,
        opts.userId,
        opts.approval.certifiedHours,
        opts.approval.reason,
      );
    const approval =
      definition.attendancePolicy && opts.userId != null
        ? await readApproval(opts.userId, client)
        : null;
    const exempt =
      opts.userId != null &&
      (pre ? pre.exempt : await isExemptRecipient(definition, opts.userId, client));
    let certificateHours = opts.hours;
    if (definition.attendancePolicy && opts.userId != null) {
      const { hours } = pre
        ? { hours: pre.hours }
        : await userHours(opts.userId, undefined, undefined, { verifiedOnly: true });
      const eligibility = evaluate(settings, hours, approval);
      if (exempt) {
        certificateHours = approval?.certifiedHours ?? settings.awardHours ?? hours;
        // An exempt person still needs a number to state when the document says hours.
        if (definition.legacyVariant === "hours" && !(certificateHours > 0))
          throw reasonError("hours_not_met");
      } else {
        if (!eligibility.eligible && eligibility.reason) throw reasonError(eligibility.reason);
        certificateHours = eligibility.certifiedHours ?? hours;
      }
    }
    if (opts.userId != null && !exempt) {
      const gate = await typeGate(definition, opts.userId, client, approval != null, pre?.gate);
      // Staff may skip these requirements for one person by giving a reason.
      if (gate && !(opts.source === "staff" && opts.overrideReason)) throw reasonError(gate);
    }
    const snapshot = await buildSnapshot(
      client,
      opts.userId,
      opts.locale,
      certificateHours,
      settings.issuerName,
      opts.guestName,
      pre && { person: pre.person, activities: pre.activities },
    );
    if (definition.legacyVariant === "activities" && snapshot.activities.length === 0)
      throw new ConflictError("There are no attended activities to list", {
        code: ERROR_REASONS.CERTIFICATE_NO_ACTIVITIES,
      });
    if (approval || (definition.attendancePolicy && opts.userId == null))
      snapshot.manuallyCertified = true;
    if (definition.attendancePolicy && settings.awardHours != null) snapshot.certifiedAward = true;
    snapshot.attendancePolicy = definition.attendancePolicy;
    snapshot.typeName = definition.name[opts.locale];
    snapshot.templateTitle = definition.title[opts.locale];
    snapshot.identityPolicy =
      definition.identityPolicy === "optional" && opts.includeIdentification === false
        ? "none"
        : definition.identityPolicy;
    snapshot.documentKind = opts.documentKind ?? "dni_nie";
    const activityName = opts.activityName?.trim() ?? "";
    if (definition.body) {
      const date = new Intl.DateTimeFormat(opts.locale, {
        dateStyle: "long",
        timeZone: snapshot.timezone,
      });
      const fields: Record<string, string> = {
        recipient: [snapshot.name, snapshot.surname].filter(Boolean).join(" "),
        issuer: snapshot.issuerName,
        event: snapshot.eventName,
        activity: activityName,
        hours: String(snapshot.hours),
        dates: `${date.format(new Date(snapshot.eventStartsAt))} – ${date.format(new Date(snapshot.eventEndsAt))}`,
        venue: snapshot.venue ?? "",
      };
      snapshot.templateBody = definition.body[opts.locale].replace(
        /\{([^{}]+)\}/g,
        (_match, key: string) => fields[key] ?? "",
      );
    }
    if (!definition.attendancePolicy && opts.hours > 0) snapshot.certifiedAward = true;
    if (opts.refresh && opts.userId != null) {
      const { rows: current } = await client.query(
        `SELECT id, variant, snapshot FROM attendance_certificates
          WHERE user_id=$1 AND type_id=$2 AND locale=$3 AND activity_name=$4
            AND revoked_at IS NULL AND superseded_at IS NULL FOR UPDATE`,
        [opts.userId, definition.id, opts.locale, activityName],
      );
      const live = current[0];
      if (live && sameStatedFacts(live.snapshot, snapshot, live.variant)) {
        const { rows: same } = await client.query(
          `SELECT ${COLUMNS} FROM attendance_certificates WHERE id=$1`,
          [live.id],
        );
        return { ...toRow(same[0]), created: false };
      }
      if (live) {
        await client.query(`UPDATE attendance_certificates SET superseded_at=now() WHERE id=$1`, [
          live.id,
        ]);
        await audit(client, {
          actorId: opts.actorId,
          entityType: "attendance_certificate",
          entityId: live.id,
          action: "certificate.supersede",
          reason: "attendance_changed",
        });
      }
    }
    const { rows } = await client.query(
      `INSERT INTO attendance_certificates
         (code, user_id, variant, locale, source, override_reason, issued_by, snapshot, type_id, activity_name, recipient_name, recipient_document_kind, recipient_document_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (user_id, type_id, locale, activity_name) WHERE revoked_at IS NULL AND superseded_at IS NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        randomBytes(18).toString("base64url"),
        opts.userId,
        opts.variant,
        opts.locale,
        opts.source,
        opts.overrideReason ?? null,
        opts.actorId,
        JSON.stringify(snapshot),
        definition.id,
        activityName,
        opts.guestName ?? null,
        opts.documentKind ?? null,
        opts.documentNumber?.trim() || null,
      ],
    );
    if (rows[0]) {
      await audit(client, {
        actorId: opts.actorId,
        entityType: "attendance_certificate",
        entityId: rows[0].id,
        action: "certificate.issue",
        source: opts.source === "bulk" ? "admin" : "web",
        after: {
          userId: opts.userId,
          typeId: definition.id,
          variant: opts.variant,
          source: opts.source,
        },
        reason: opts.overrideReason ?? undefined,
      });
      return { ...toRow(rows[0]), created: true };
    }
    const { rows: live } = await client.query(
      `SELECT ${COLUMNS} FROM attendance_certificates
        WHERE user_id = $1 AND type_id = $2 AND locale = $3 AND activity_name=$4 AND revoked_at IS NULL AND superseded_at IS NULL`,
      [opts.userId, definition.id, opts.locale, activityName],
    );
    return { ...toRow(live[0]), created: false };
  });
}

/** A participant requests their own certificate (#1083). */
export async function issueForSelf(
  userId: number,
  variant: CertificateVariant,
  locale: CertificateLocale,
  typeId?: number,
  refresh = false,
): Promise<CertificateRow> {
  const definition = await readCertificateType(typeId, variant);
  await assertTypeRecipient(definition, userId, pool, true);
  if (definition.audienceRoleIds == null && !(await hasEventAccess(pool, userId))) {
    throw new ForbiddenError("Certificates are only available to event attendees");
  }
  // The type's requirements are enforced inside the issuing transaction.
  return insertCertificate({
    userId,
    variant: definition.legacyVariant === "accepted_spot" ? "participation" : variant,
    locale,
    typeId: definition.id,
    source: "self",
    actorId: userId,
    hours: 0,
    refresh,
  });
}

/**
 * Staff issue one certificate. Below the policy an override reason is
 * required, and the override is audited with it.
 */
export async function issueForStaff(
  actorId: number,
  input: {
    userId: number;
    variant: CertificateVariant;
    locale: CertificateLocale;
    overrideReason?: string | null;
    certifiedHours?: number;
  },
): Promise<CertificateRow> {
  await assertFixtureSubjectScope(pool, actorId, input.userId);
  const eligibility = await eligibilityFor(input.userId);
  const overridden = !eligibility.eligible;
  if (overridden && !input.overrideReason) {
    throw reasonError(eligibility.reason ?? "not_available");
  }
  if (
    (overridden || input.certifiedHours != null) &&
    (!input.overrideReason || input.certifiedHours == null)
  ) {
    throw new BadRequestError("A manual award requires certified hours and a review reason");
  }
  return insertCertificate({
    userId: input.userId,
    variant: input.variant,
    locale: input.locale,
    source: "staff",
    actorId,
    overrideReason: overridden ? input.overrideReason : null,
    hours: eligibility.certifiedHours ?? eligibility.hours,
    ...(input.certifiedHours != null && input.overrideReason
      ? { approval: { certifiedHours: input.certifiedHours, reason: input.overrideReason } }
      : {}),
  });
}

/** Reasons that leave one person out of a bulk run without stopping it. */
const SKIPPED_IN_BULK = new Set<string>([
  ERROR_REASONS.CERTIFICATE_NO_ACTIVITIES,
  ERROR_REASONS.CERTIFICATE_EVENT_NOT_ENDED,
  ERROR_REASONS.CERTIFICATE_DEMO_REQUIRED,
  ERROR_REASONS.CERTIFICATE_DEMO_JURY_REQUIRED,
]);

/** Reads for the whole batch in set-based queries; each issuance then only re-reads what it locks. */
async function preloadBulk(
  userIds: number[],
  hoursByUser: Map<number, number>,
  variant: CertificateVariant,
  locale: CertificateLocale,
): Promise<Map<number, BulkRecipient>> {
  const result = new Map<number, BulkRecipient>();
  if (userIds.length === 0) return result;
  const definition = await readCertificateType(undefined, variant);
  const idList = [userIds];
  const [users, event, activities, audience, exempt, presented] = await Promise.all([
    pool.query(
      `SELECT u.id, u.dni, u.name, u.surname FROM users u
        WHERE u.id = ANY($1::int[]) AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
      idList,
    ),
    pool.query(
      `SELECT name AS event_name, venue_name, timezone, event_starts_at, event_ends_at FROM event_config WHERE id = 1`,
    ),
    attendedActivitiesFor(pool, userIds, locale),
    roleHolders(userIds, definition.audienceRoleIds),
    roleHolders(userIds, definition.exemptRoleIds),
    definition.demoRequirement === "none"
      ? new Map<number, Presentations>()
      : presentationsFor(userIds),
  ]);
  const eventRow = event.rows[0] ?? {};
  for (const user of users.rows) {
    result.set(user.id, {
      definition,
      hours: hoursByUser.get(user.id) ?? 0,
      matchesAudience: definition.audienceRoleIds == null || audience.has(user.id),
      exempt: exempt.has(user.id),
      dni: user.dni ?? null,
      person: { ...eventRow, name: user.name, surname: user.surname },
      activities: activities.get(user.id) ?? [],
      gate: {
        eventEndsAt: (eventRow.event_ends_at as Date | null | undefined) ?? null,
        presented: presented.get(user.id) ?? NO_PRESENTATIONS(),
      },
    });
  }
  return result;
}

/** Which of these people hold any of the given roles. */
async function roleHolders(userIds: number[], roleIds: number[] | null): Promise<Set<number>> {
  if (!roleIds?.length) return new Set();
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id
      WHERE ur.user_id = ANY($1::int[]) AND r.id = ANY($2::int[]) AND r.deleted_at IS NULL`,
    [userIds, roleIds],
  );
  return new Set(rows.map((row) => row.user_id));
}

/** Issues the variant to everyone who meets the policy; already issued ones are skipped. */
export async function issueInBulk(
  actorId: number,
  variant: CertificateVariant,
  locale: CertificateLocale,
): Promise<{ issued: number; existing: number; skipped: number }> {
  const people = (await certificateParticipants(actorId)).filter(
    (p) => p.hasAttendanceEvidence || p.eligibility.approval,
  );
  const candidates = people.filter((p) => p.eligibility.eligible);
  const preloaded = await preloadBulk(
    candidates.map((p) => p.userId),
    new Map(candidates.map((p) => [p.userId, p.eligibility.hours])),
    variant,
    locale,
  );
  let issued = 0;
  let existing = 0;
  let skipped = 0;
  for (const person of people) {
    if (!person.eligibility.eligible) {
      skipped++;
      continue;
    }
    try {
      // Each person is still issued in their own transaction, so one skip never undoes another.
      const result = await insertCertificate({
        userId: person.userId,
        variant,
        locale,
        source: "bulk",
        actorId,
        hours: person.eligibility.certifiedHours ?? person.eligibility.hours,
        preloaded: preloaded.get(person.userId),
      });
      if (result.created) issued++;
      else existing++;
    } catch (err) {
      // Not available to this person yet; the rest of the batch still goes out.
      if (err instanceof ConflictError && SKIPPED_IN_BULK.has(err.details?.code as string)) {
        skipped++;
        continue;
      }
      throw err;
    }
  }
  return { issued, existing, skipped };
}

export async function revokeCertificate(
  actorId: number,
  id: number,
  reason: string,
): Promise<CertificateRow> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE attendance_certificates
          SET revoked_at = now(), revoked_by = $2, revoked_reason = $3
        WHERE id = $1 AND revoked_at IS NULL
      RETURNING ${COLUMNS}`,
      [id, actorId, reason],
    );
    if (!rows[0]) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM attendance_certificates WHERE id = $1`,
        [id],
      );
      if (!rowCount) throw new NotFoundError("Certificate not found");
      throw new ConflictError("The certificate is already revoked");
    }
    await audit(client, {
      actorId,
      entityType: "attendance_certificate",
      entityId: id,
      action: "certificate.revoke",
      reason,
    });
    return toRow(rows[0]);
  });
}

export async function listForUser(userId: number): Promise<CertificateRow[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS}, snapshot FROM attendance_certificates WHERE user_id = $1 ORDER BY issued_at DESC, id DESC`,
    [userId],
  );
  const certificates = rows.map(toRow);
  // Flag current attendance documents whose stated hours or activities no longer match.
  const candidates = rows.filter(
    (row) =>
      !row.revoked_at &&
      !row.superseded_at &&
      row.snapshot?.attendancePolicy === true &&
      row.snapshot?.templateBody == null &&
      (row.variant === "hours" || row.variant === "activities"),
  );
  if (candidates.length > 0) {
    const eligibility = await eligibilityFor(userId);
    const activitiesByLocale = new Map<string, Awaited<ReturnType<typeof attendedActivities>>>();
    for (const row of candidates) {
      const current = certificates.find((cert) => cert.id === row.id);
      if (!current || !eligibility.eligible) continue;
      const snapshot = row.snapshot as CertificateSnapshot;
      let activities = activitiesByLocale.get(row.locale);
      if (!activities) {
        activities = await attendedActivities(pool, userId, row.locale);
        activitiesByLocale.set(row.locale, activities);
      }
      const fresh = {
        ...snapshot,
        hours: eligibility.certifiedHours ?? eligibility.hours,
        activities,
      };
      current.outdated = !sameStatedFacts(snapshot, fresh, row.variant);
    }
  }
  return certificates;
}

/** The id behind a verification code. */
export async function certificateIdByCode(code: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM attendance_certificates WHERE code = $1`,
    [code],
  );
  if (!rows[0]) throw new NotFoundError("Certificate not found");
  return rows[0].id;
}

/** The certificate's owner, for access checks. */
export async function certificateOwner(id: number): Promise<number | null> {
  const { rows } = await pool.query<{ user_id: number | null }>(
    `SELECT user_id FROM attendance_certificates WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Certificate not found");
  return rows[0].user_id;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * The certificate's single PDF copy (#1083). The first request renders it,
 * stamps the verification footer and stores it with its SHA-256; every later
 * request, owner, staff or public viewer, receives the same bytes. A copy that
 * no longer matches its hash is never served. Revocation drops the copy (trigger).
 */
export async function renderCertificate(
  id: number,
): Promise<{ pdf: Uint8Array; filename: string }> {
  const columns = `c.code, c.variant, c.locale, c.issued_at, c.revoked_at, c.snapshot, c.pdf, c.pdf_sha256`;
  const stored = (row: { pdf: Buffer; pdf_sha256: string; variant: string }) => {
    if (sha256(row.pdf) !== row.pdf_sha256)
      throw new AppError(
        500,
        "certificate_copy_corrupt",
        "The stored certificate copy is corrupt",
        {
          code: ERROR_REASONS.CERTIFICATE_COPY_CORRUPT,
        },
      );
    return { pdf: row.pdf, filename: `certificate-${row.variant}-${id}.pdf` };
  };
  const { rows: first } = await pool.query(
    `SELECT ${columns} FROM attendance_certificates c WHERE c.id = $1`,
    [id],
  );
  if (!first[0]) throw new NotFoundError("Certificate not found");
  if (first[0].revoked_at) throw new ConflictError("The certificate was revoked");
  if (first[0].pdf) return stored(first[0]);

  return withTransaction(async (client) => {
    // Concurrent first downloads converge on one generated copy.
    const { rows } = await client.query(
      `SELECT ${columns}, COALESCE(c.recipient_document_number,u.dni) AS dni
         FROM attendance_certificates c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Certificate not found");
    if (row.revoked_at) throw new ConflictError("The certificate was revoked");
    if (row.pdf) return stored(row);
    const snapshot = row.snapshot as CertificateSnapshot;
    const generatedAt = new Date();
    const pdf = await stampCopyFooter(
      await renderCertificatePdf({
        snapshot,
        variant: row.variant,
        locale: row.locale,
        issuedAt: row.issued_at,
        dni: snapshot.identityPolicy === "none" ? null : (row.dni ?? null),
      }),
      {
        issuer: snapshot.issuerName,
        code: row.code,
        verifyUrl: `${config.WEB_URL.replace(/\/$/, "")}/verify/${row.code}`,
        locale: row.locale,
        printedAt: generatedAt,
        timezone: snapshot.timezone,
      },
    );
    await client.query(
      `UPDATE attendance_certificates SET pdf=$2, pdf_sha256=$3, pdf_generated_at=$4 WHERE id=$1`,
      [id, Buffer.from(pdf), sha256(pdf), generatedAt],
    );
    return { pdf, filename: `certificate-${row.variant}-${id}.pdf` };
  });
}

export interface Verification {
  status: "valid" | "revoked";
  variant: CertificateVariant;
  issuedAt: string;
  issuerName: string | null;
  name: string | null;
  surname: string | null;
  eventName: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  /** Only documents that state certified hours (see `statesHours`) expose them. */
  hours: number | null;
  /** SHA-256 and generation time of the stored copy; null until it is first downloaded or once revoked. */
  sha256: string | null;
  generatedAt: string | null;
  /** A newer certificate replaced this one; it remains valid as issued. */
  supersededAt: string | null;
}

/** Public verification by code: never the DNI, and no personal data once revoked. Generates the stored copy when none exists yet. */
export async function verifyCode(code: string): Promise<Verification> {
  // A valid certificate always has its copy: the fingerprint is part of what is verified.
  const { rows: pending } = await pool.query(
    `SELECT id FROM attendance_certificates WHERE code = $1 AND revoked_at IS NULL AND pdf IS NULL`,
    [code],
  );
  if (pending[0]) await renderCertificate(pending[0].id);
  const { rows } = await pool.query(
    `SELECT variant, issued_at, revoked_at, snapshot, pdf_sha256, pdf_generated_at, superseded_at FROM attendance_certificates WHERE code = $1`,
    [code],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("Certificate not found");
  const snapshot = row.snapshot as Partial<CertificateSnapshot>;
  const revoked = row.revoked_at != null;
  return {
    status: revoked ? "revoked" : "valid",
    variant: row.variant,
    issuedAt: (row.issued_at as Date).toISOString(),
    issuerName: snapshot.issuerName ?? null,
    name: revoked ? null : (snapshot.name ?? null),
    surname: revoked ? null : (snapshot.surname ?? null),
    eventName: snapshot.eventName ?? null,
    eventStartsAt: snapshot.eventStartsAt ?? null,
    eventEndsAt: snapshot.eventEndsAt ?? null,
    hours: !revoked && statesHours(snapshot, row.variant) ? (snapshot.hours ?? null) : null,
    supersededAt: row.superseded_at ? (row.superseded_at as Date).toISOString() : null,
    sha256: row.pdf_sha256 ?? null,
    generatedAt: row.pdf_generated_at ? (row.pdf_generated_at as Date).toISOString() : null,
  };
}

/** Which stored copy has this fingerprint, answered like a verification by its code. */
export async function verifyByHash(sha256: string): Promise<Verification & { code: string }> {
  const { rows } = await pool.query(
    `SELECT code FROM attendance_certificates WHERE pdf_sha256 = $1 AND revoked_at IS NULL LIMIT 1`,
    [sha256],
  );
  if (!rows[0]) throw new NotFoundError("No certificate matches this file");
  return { code: rows[0].code, ...(await verifyCode(rows[0].code)) };
}

export interface CertificateParticipant {
  userId: number;
  name: string;
  surname: string | null;
  universityId: number | null;
  universityName: string | null;
  hasAttendanceEvidence: boolean;
  eligibility: Eligibility;
}

/** #1083: real event attendees, including people whose attendance needs review. */
export async function certificateParticipants(
  actorId: number,
  universityId?: number,
): Promise<CertificateParticipant[]> {
  const scope = await fixtureReadFilter(pool, actorId, "u");
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.surname, un.id AS university_id, un.name AS university_name
    FROM users u
    LEFT JOIN universities un ON un.id = ${userUniversityIdSql("u.id")}
    WHERE u.account_state='active' AND u.anonymized_at IS NULL
      AND EXISTS (SELECT 1 FROM user_event_access ea WHERE ea.user_id=u.id)
      AND ($1::int IS NULL OR un.id=$1) ${scope}
    ORDER BY u.surname NULLS LAST, u.name, u.id`,
    [universityId ?? null],
  );
  const [settings, hours, approvals] = await Promise.all([
    readSettings(),
    allHours(undefined, actorId, { verifiedOnly: true }),
    pool.query(
      `SELECT user_id, certified_hours, reason, approved_by, approved_at FROM certificate_approvals`,
    ),
  ]);
  const byUser = new Map(hours.map((row) => [row.userId, row.hours]));
  const awards = new Map<number, CertificateApproval>(
    approvals.rows.map((r) => [
      r.user_id,
      {
        certifiedHours: Number(r.certified_hours),
        reason: r.reason,
        approvedBy: r.approved_by,
        approvedAt: r.approved_at.toISOString(),
      },
    ]),
  );
  return rows.map((row) => ({
    userId: row.id,
    name: row.name ?? "",
    surname: row.surname,
    universityId: row.university_id,
    universityName: row.university_name,
    hasAttendanceEvidence: byUser.has(row.id),
    eligibility: evaluate(settings, byUser.get(row.id) ?? 0, awards.get(row.id) ?? null),
  }));
}

/** #1083: university submissions use awarded hours, never replace the raw evidence. */
export async function exportCertificateParticipants(
  actorId: number,
  options: { universityId?: number; format: "general" | "udc" },
): Promise<string> {
  const people = (await certificateParticipants(actorId, options.universityId)).filter(
    (p) => p.eligibility.hours > 0 || p.eligibility.approval,
  );
  const { rows } = await pool.query(`SELECT id, email, dni FROM users WHERE id=ANY($1::int[])`, [
    people.map((p) => p.userId),
  ]);
  const contacts = new Map(rows.map((r) => [r.id, r]));
  let csv: string;
  if (options.format === "udc") {
    const { rows: events } = await pool.query(
      `SELECT name, venue_name, timezone, event_starts_at, event_ends_at FROM event_config WHERE id=1`,
    );
    const event = events[0];
    if (!event?.event_starts_at || !event.event_ends_at)
      throw new ConflictError("The event dates are not set");
    const settings = await readSettings();
    const date = new Intl.DateTimeFormat("gl", {
      timeZone: event.timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    csv = toCsv(
      [
        "Nome Asociación",
        "Nome e apelidos",
        "DNI",
        "Nome da actividade",
        "Data da actividade",
        "Lugar de realización",
        "Nº de horas realizadas",
        "Observacións",
      ],
      people
        .filter((p) => p.eligibility.eligible)
        .map((p) => [
          settings.issuerName,
          [p.name, p.surname].filter(Boolean).join(" "),
          contacts.get(p.userId)?.dni,
          event.name,
          `${date.format(event.event_starts_at)} – ${date.format(event.event_ends_at)}`,
          event.venue_name,
          p.eligibility.certifiedHours,
          "",
        ]),
    );
  } else {
    const header = [
      "user_id",
      "name",
      "surname",
      "email",
      "dni",
      "university",
      "measured_hours",
      "certified_hours",
      "status",
    ];
    csv = toCsv(
      header,
      recordsToCsv(
        header,
        people.map((p) => ({
          user_id: p.userId,
          name: p.name,
          surname: p.surname,
          email: contacts.get(p.userId)?.email,
          dni: contacts.get(p.userId)?.dni,
          university: p.universityName,
          measured_hours: p.eligibility.hours,
          certified_hours: p.eligibility.certifiedHours,
          status: p.eligibility.approval
            ? "approved"
            : p.eligibility.eligible
              ? "automatic"
              : p.eligibility.reason,
        })),
      ),
    );
  }
  await withTransaction((client) =>
    audit(client, {
      actorId,
      entityType: "certificate_export",
      entityId: options.universityId ?? "all",
      action: "export",
      after: { format: options.format, universityId: options.universityId ?? null },
    }),
  );
  return csv;
}

/** Wraps a pool so identical read queries made through it run once (callers must only read). */
function memoizedReads(db: pg.Pool): pg.Pool {
  const cache = new Map<string, Promise<unknown>>();
  return {
    query: (text: unknown, values?: unknown[]) => {
      if (typeof text !== "string") return (db.query as (...a: unknown[]) => unknown)(text, values);
      const key = `${text}\u0000${JSON.stringify(values ?? [])}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = db.query(text, values);
        cache.set(key, hit);
      }
      return hit;
    },
  } as unknown as pg.Pool;
}

/** The types this person can be issued, each with why not yet (null when available now). */
export async function availableCertificateTypes(userId: number, self: boolean) {
  const types = await listCertificateTypes();
  // The per-type checks repeat the same user-wide reads (event access, event
  // end, presentations); share one result per distinct query within this call.
  const reads = memoizedReads(pool);
  const roleIds = await activeRoleIds(userId, reads);
  const matches = await Promise.all(
    types.map(async (type) =>
      (await recipientMatchesType(type, userId, reads, self, roleIds)) ? type : null,
    ),
  );
  const eligibility = await eligibilityFor(userId);
  return Promise.all(
    matches
      .filter((type) => type != null)
      .map(async (type) => {
        let availability: GateReason | null = null;
        if (!(await isExemptRecipient(type, userId, reads, roleIds))) {
          availability =
            (await typeGate(type, userId, reads, eligibility.approval != null)) ??
            (type.attendancePolicy && !eligibility.eligible ? eligibility.reason : null);
        }
        return { ...type, availability };
      }),
  );
}

export interface ConfiguredIssueInput {
  typeId: number;
  locale: CertificateLocale;
  userId?: number;
  guestName?: string;
  documentKind?: "dni_nie" | "passport";
  documentNumber?: string;
  includeIdentification?: boolean;
  activityName?: string;
  certifiedHours?: number;
  overrideReason?: string;
  refresh?: boolean;
}

export async function issueConfiguredCertificate(
  actorId: number,
  input: ConfiguredIssueInput,
): Promise<CertificateRow> {
  const definition = await readCertificateType(input.typeId);
  if ((input.userId == null) === !input.guestName?.trim())
    throw new BadRequestError("Choose an account or enter a guest name");
  if (definition.legacyVariant === "accepted_spot" && input.certifiedHours != null)
    throw new BadRequestError("Accepted spot certificates do not award attendance hours");
  let hours = input.certifiedHours ?? 0;
  let approval: IssueOptions["approval"];
  if (
    input.userId == null &&
    definition.attendancePolicy &&
    !(input.certifiedHours && input.overrideReason)
  )
    throw new BadRequestError(
      "Guest attendance certificates require explicit hours and a review reason",
    );
  if (input.userId != null) {
    await assertFixtureSubjectScope(pool, actorId, input.userId);
    await assertTypeRecipient(definition, input.userId);
    if (definition.attendancePolicy && !(await isExemptRecipient(definition, input.userId))) {
      const eligibility = await eligibilityFor(input.userId);
      if (!eligibility.eligible && !(input.overrideReason && input.certifiedHours != null))
        throw reasonError(eligibility.reason ?? "not_available");
      hours = input.certifiedHours ?? eligibility.certifiedHours ?? eligibility.hours;
      if (input.certifiedHours != null) {
        if (!input.overrideReason)
          throw new BadRequestError("An attendance override requires a review reason");
        approval = { certifiedHours: input.certifiedHours, reason: input.overrideReason };
      }
    }
  }
  return insertCertificate({
    userId: input.userId ?? null,
    typeId: definition.id,
    variant:
      definition.legacyVariant === "accepted_spot"
        ? "participation"
        : (definition.legacyVariant ?? "participation"),
    locale: input.locale,
    source: "staff",
    actorId,
    hours,
    approval,
    guestName: input.guestName,
    documentKind: input.documentKind,
    documentNumber: input.documentNumber,
    includeIdentification: input.includeIdentification,
    activityName: input.activityName,
    overrideReason: input.overrideReason,
    refresh: input.refresh,
  });
}

export async function listIssuedCertificates(actorId: number) {
  const fixture = await fixtureReadFilter(pool, actorId, "u");
  const { rows } = await pool.query(
    `SELECT c.id FROM attendance_certificates c LEFT JOIN users u ON u.id=c.user_id
    WHERE (c.user_id IS NULL AND NOT EXISTS(SELECT 1 FROM users actor WHERE actor.id=$1 AND actor.is_test_account=true))
       OR (c.user_id IS NOT NULL ${fixture}) ORDER BY c.issued_at DESC,c.id DESC`,
    [actorId],
  );
  if (!rows.length) return [];
  const { rows: records } = await pool.query(
    `SELECT ${COLUMNS} FROM attendance_certificates WHERE id=ANY($1::int[]) ORDER BY issued_at DESC,id DESC`,
    [rows.map((r) => r.id)],
  );
  return records.map(toRow);
}
