import { randomBytes } from "node:crypto";
import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type pg from "pg";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { recordsToCsv, toCsv } from "../../lib/csv.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { stampCopyFooter } from "../../lib/pdf-copy-footer.js";
import { hasEventAccess } from "../identity/role.js";
import { allHours, userHours } from "../logistics/presence.js";
import { assertFixtureSubjectScope, fixtureReadFilter } from "../logistics/review-fixture-scope.js";
import {
  type CertificateLocale,
  type CertificateSnapshot,
  type CertificateVariant,
  renderCertificatePdf,
} from "./pdf.js";

/** #1083: the organisation-wide certificate policy (one row). */
export interface CertificateSettings {
  /** Verified venue hours needed for automatic issue; null switches it off. */
  minHours: number | null;
  minReviewHours: number | null;
  awardHours: number | null;
  /** Only people whose team presented a project are eligible. */
  requiresDemo: boolean;
  issuerName: string;
}

export async function readSettings(
  db: pg.Pool | pg.PoolClient = pool,
): Promise<CertificateSettings> {
  const { rows } = await db.query(
    `SELECT min_hours, min_review_hours, award_hours, requires_demo, issuer_name FROM certificate_settings WHERE id = 1`,
  );
  const row = rows[0];
  return {
    minHours: row.min_hours == null ? null : Number(row.min_hours),
    minReviewHours: row.min_review_hours == null ? null : Number(row.min_review_hours),
    awardHours: row.award_hours == null ? null : Number(row.award_hours),
    requiresDemo: row.requires_demo,
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
      `UPDATE certificate_settings SET min_hours = $1, requires_demo = $2, issuer_name = $3, min_review_hours = $4, award_hours = $5 WHERE id = 1`,
      [next.minHours, next.requiresDemo, next.issuerName, next.minReviewHours, next.awardHours],
    );
    if (next.awardHours !== before.awardHours) {
      const { rows } = await client.query(
        `UPDATE attendance_certificates
        SET revoked_at=now(), revoked_by=$1, revoked_reason='certificate_award_policy_changed'
        WHERE revoked_at IS NULL AND snapshot->>'manuallyCertified' IS DISTINCT FROM 'true' RETURNING id`,
        [actorId],
      );
      for (const row of rows)
        await audit(client, {
          actorId,
          entityType: "attendance_certificate",
          entityId: row.id,
          action: "certificate.revoke",
          reason: "certificate_award_policy_changed",
        });
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

export type EligibilityReason =
  | "not_available"
  | "hours_not_met"
  | "demo_required"
  | "review_required";

export interface Eligibility {
  hours: number;
  certifiedHours: number | null;
  reviewRequired: boolean;
  approval: CertificateApproval | null;
  demoed: boolean;
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
  demoed: boolean,
  approval: CertificateApproval | null = null,
): Eligibility {
  let reason: EligibilityReason | null = null;
  const reviewRequired =
    !approval && settings.minReviewHours != null && hours > 0 && hours >= settings.minReviewHours;
  if (!approval) {
    if (settings.minHours == null) reason = "not_available";
    else if (hours < settings.minHours || hours <= 0) reason = "hours_not_met";
    else if (settings.requiresDemo && !demoed) reason = "demo_required";
    if (reason && reviewRequired) reason = "review_required";
  }
  return {
    hours,
    demoed,
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
    WHERE user_id=$1 AND revoked_at IS NULL AND ((snapshot->>'hours')::numeric IS DISTINCT FROM $3::numeric OR snapshot->>'manuallyCertified' IS DISTINCT FROM 'true') RETURNING id`,
    [userId, actorId, certifiedHours],
  );
  for (const row of rows)
    await audit(client, {
      actorId,
      entityType: "attendance_certificate",
      entityId: row.id,
      action: "certificate.revoke",
      reason: "certified_hours_reviewed",
    });
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

/** Teams that presented: their queue entry started or finished a presentation. */
const DEMOED_SQL = `
  SELECT DISTINCT s.user_id
    FROM submissions s
    JOIN queue_entries q ON q.repo_id = s.repo_id
   WHERE s.status = 'active'
     AND (q.completed_at IS NOT NULL OR q.presentation_started_at IS NOT NULL)
     AND ($1::int[] IS NULL OR s.user_id = ANY($1))`;

async function demoedUsers(userIds: number[] | null): Promise<Set<number>> {
  const { rows } = await pool.query<{ user_id: number }>(DEMOED_SQL, [userIds]);
  return new Set(rows.map((row) => row.user_id));
}

export async function eligibilityFor(userId: number): Promise<Eligibility> {
  const [settings, { hours }, demoed, approval] = await Promise.all([
    readSettings(),
    userHours(userId, undefined, undefined, { verifiedOnly: true }),
    demoedUsers([userId]),
    readApproval(userId),
  ]);
  return evaluate(settings, hours, demoed.has(userId), approval);
}

function reasonError(reason: EligibilityReason): ConflictError {
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
  userId: number,
  locale: CertificateLocale,
  hours: number,
  issuerName: string,
): Promise<CertificateSnapshot> {
  const { rows: people } = await db.query(
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
  // Meals are not activities a certificate should list.
  const { rows: activities } = await db.query(
    `SELECT COALESCE(a.name_i18n ->> $2, a.name) AS name, min(l.logged_at) AS at
       FROM activity_logs l JOIN activities a ON a.id = l.activity_id
      WHERE l.user_id = $1 AND NOT (a.category = ANY($3::text[]))
      GROUP BY a.id, a.name, a.name_i18n
      ORDER BY min(l.logged_at), a.id`,
    [userId, locale, [...MEAL_ACTIVITY_KINDS]],
  );
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
    activities: activities.map((row) => ({
      name: String(row.name),
      at: (row.at as Date).toISOString(),
    })),
  };
}

export interface CertificateRow {
  id: number;
  code: string;
  userId: number;
  variant: CertificateVariant;
  locale: CertificateLocale;
  source: "self" | "bulk" | "staff";
  overrideReason: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

function toRow(row: Record<string, unknown>): CertificateRow {
  return {
    id: row.id as number,
    code: row.code as string,
    userId: row.user_id as number,
    variant: row.variant as CertificateVariant,
    locale: row.locale as CertificateLocale,
    source: row.source as CertificateRow["source"],
    overrideReason: (row.override_reason as string | null) ?? null,
    issuedAt: (row.issued_at as Date).toISOString(),
    revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
    revokedReason: (row.revoked_reason as string | null) ?? null,
  };
}

const COLUMNS = `id, code, user_id, variant, locale, source, override_reason, issued_at,
                 revoked_at, revoked_reason`;

interface IssueOptions {
  userId: number;
  variant: CertificateVariant;
  locale: CertificateLocale;
  source: "self" | "bulk" | "staff";
  actorId: number | null;
  overrideReason?: string | null;
  hours: number;
  approval?: { certifiedHours: number; reason: string };
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
    await lockPerson(client, opts.userId);
    if (opts.approval && opts.actorId != null)
      await recordApproval(
        client,
        opts.actorId,
        opts.userId,
        opts.approval.certifiedHours,
        opts.approval.reason,
      );
    const approval = await readApproval(opts.userId, client);
    const snapshot = await buildSnapshot(
      client,
      opts.userId,
      opts.locale,
      approval?.certifiedHours ?? settings.awardHours ?? opts.hours,
      settings.issuerName,
    );
    if (approval) snapshot.manuallyCertified = true;
    if (settings.awardHours != null) snapshot.certifiedAward = true;
    const { rows } = await client.query(
      `INSERT INTO attendance_certificates
         (code, user_id, variant, locale, source, override_reason, issued_by, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, variant, locale) WHERE revoked_at IS NULL DO NOTHING
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
      ],
    );
    if (rows[0]) {
      await audit(client, {
        actorId: opts.actorId,
        entityType: "attendance_certificate",
        entityId: rows[0].id,
        action: "certificate.issue",
        source: opts.source === "bulk" ? "admin" : "web",
        after: { userId: opts.userId, variant: opts.variant, source: opts.source },
        reason: opts.overrideReason ?? undefined,
      });
      return { ...toRow(rows[0]), created: true };
    }
    const { rows: live } = await client.query(
      `SELECT ${COLUMNS} FROM attendance_certificates
        WHERE user_id = $1 AND variant = $2 AND locale = $3 AND revoked_at IS NULL`,
      [opts.userId, opts.variant, opts.locale],
    );
    return { ...toRow(live[0]), created: false };
  });
}

/** A participant requests their own certificate (#1083). */
export async function issueForSelf(
  userId: number,
  variant: CertificateVariant,
  locale: CertificateLocale,
): Promise<CertificateRow> {
  if (!(await hasEventAccess(pool, userId))) {
    throw new ForbiddenError("Certificates are only available to event attendees");
  }
  const eligibility = await eligibilityFor(userId);
  if (!eligibility.eligible && eligibility.reason) throw reasonError(eligibility.reason);
  return insertCertificate({
    userId,
    variant,
    locale,
    source: "self",
    actorId: userId,
    hours: eligibility.hours,
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

/** Issues the variant to everyone who meets the policy; already issued ones are skipped. */
export async function issueInBulk(
  actorId: number,
  variant: CertificateVariant,
  locale: CertificateLocale,
): Promise<{ issued: number; existing: number; skipped: number }> {
  const people = (await certificateParticipants(actorId)).filter(
    (p) => p.hasAttendanceEvidence || p.eligibility.approval,
  );
  let issued = 0;
  let existing = 0;
  let skipped = 0;
  for (const person of people) {
    if (!person.eligibility.eligible) {
      skipped++;
      continue;
    }
    const result = await insertCertificate({
      userId: person.userId,
      variant,
      locale,
      source: "bulk",
      actorId,
      hours: person.eligibility.certifiedHours ?? person.eligibility.hours,
    });
    if (result.created) issued++;
    else existing++;
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
    `SELECT ${COLUMNS} FROM attendance_certificates WHERE user_id = $1 ORDER BY issued_at DESC, id DESC`,
    [userId],
  );
  return rows.map(toRow);
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
export async function certificateOwner(id: number): Promise<number> {
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM attendance_certificates WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Certificate not found");
  return rows[0].user_id;
}

/**
 * The certificate PDF. `copy` stamps the CSV footer (QR, code, print date) for participants;
 * without it staff get the bare document to sign (#1083).
 */
export async function renderCertificate(
  id: number,
  opts: { copy: boolean },
): Promise<{ pdf: Uint8Array; filename: string }> {
  const { rows } = await pool.query(
    `SELECT c.code, c.variant, c.locale, c.issued_at, c.revoked_at, c.snapshot, u.dni
       FROM attendance_certificates c JOIN users u ON u.id = c.user_id
      WHERE c.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("Certificate not found");
  if (row.revoked_at) throw new ConflictError("The certificate was revoked");
  const snapshot = row.snapshot as CertificateSnapshot;
  let pdf = await renderCertificatePdf({
    snapshot,
    variant: row.variant,
    locale: row.locale,
    issuedAt: row.issued_at,
    dni: row.dni ?? null,
  });
  if (opts.copy) {
    pdf = await stampCopyFooter(pdf, {
      issuer: snapshot.issuerName,
      code: row.code,
      verifyUrl: `${config.WEB_URL.replace(/\/$/, "")}/verify/${row.code}`,
      locale: row.locale,
      printedAt: new Date(),
      timezone: snapshot.timezone,
    });
  }
  return { pdf, filename: `certificate-${row.variant}-${id}.pdf` };
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
  /** Hours variants and manually awarded documents state certified hours. */
  hours: number | null;
}

/** Public verification by code: never the DNI, and no personal data once revoked. */
export async function verifyCode(code: string): Promise<Verification> {
  const { rows } = await pool.query(
    `SELECT variant, issued_at, revoked_at, snapshot FROM attendance_certificates WHERE code = $1`,
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
    hours:
      !revoked && (row.variant === "hours" || snapshot.manuallyCertified || snapshot.certifiedAward)
        ? (snapshot.hours ?? null)
        : null,
  };
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
    `SELECT u.id, u.name, u.surname, u.university_id, un.name AS university_name
    FROM users u LEFT JOIN universities un ON un.id=u.university_id
    WHERE u.account_state='active' AND u.anonymized_at IS NULL
      AND EXISTS (SELECT 1 FROM user_event_access ea WHERE ea.user_id=u.id)
      AND ($1::int IS NULL OR u.university_id=$1) ${scope}
    ORDER BY u.surname NULLS LAST, u.name, u.id`,
    [universityId ?? null],
  );
  const [settings, hours, demoed, approvals] = await Promise.all([
    readSettings(),
    allHours(undefined, actorId, { verifiedOnly: true }),
    demoedUsers(null),
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
    eligibility: evaluate(
      settings,
      byUser.get(row.id) ?? 0,
      demoed.has(row.id),
      awards.get(row.id) ?? null,
    ),
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
