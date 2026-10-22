import { randomBytes } from "node:crypto";
import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type pg from "pg";
import { config } from "../../config.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";
import { allHours, userHours } from "../logistics/presence.js";
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
  /** Only people whose team presented a project are eligible. */
  requiresDemo: boolean;
  issuerName: string;
}

export async function readSettings(
  db: pg.Pool | pg.PoolClient = pool,
): Promise<CertificateSettings> {
  const { rows } = await db.query(
    `SELECT min_hours, requires_demo, issuer_name FROM certificate_settings WHERE id = 1`,
  );
  const row = rows[0];
  return {
    minHours: row.min_hours == null ? null : Number(row.min_hours),
    requiresDemo: row.requires_demo,
    issuerName: row.issuer_name,
  };
}

export async function updateSettings(
  actorId: number,
  patch: Partial<CertificateSettings>,
): Promise<CertificateSettings> {
  return withTransaction(async (client) => {
    const before = await readSettings(client);
    const next = { ...before, ...patch };
    await client.query(
      `UPDATE certificate_settings SET min_hours = $1, requires_demo = $2, issuer_name = $3 WHERE id = 1`,
      [next.minHours, next.requiresDemo, next.issuerName],
    );
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

export type EligibilityReason = "not_available" | "hours_not_met" | "demo_required";

export interface Eligibility {
  hours: number;
  demoed: boolean;
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: EligibilityReason | null;
}

function evaluate(settings: CertificateSettings, hours: number, demoed: boolean): Eligibility {
  let reason: EligibilityReason | null = null;
  if (settings.minHours == null) reason = "not_available";
  else if (hours < settings.minHours || hours <= 0) reason = "hours_not_met";
  else if (settings.requiresDemo && !demoed) reason = "demo_required";
  return { hours, demoed, eligible: reason === null, reason };
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
  const [settings, { hours }, demoed] = await Promise.all([
    readSettings(),
    userHours(userId),
    demoedUsers([userId]),
  ]);
  return evaluate(settings, hours, demoed.has(userId));
}

function reasonError(reason: EligibilityReason): ConflictError {
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
}

/**
 * Inserts the certificate, or returns the live one for the same person and
 * variant (the partial unique index makes concurrent requests converge).
 */
async function insertCertificate(
  opts: IssueOptions,
): Promise<CertificateRow & { created: boolean }> {
  const settings = await readSettings();
  return withTransaction(async (client) => {
    const snapshot = await buildSnapshot(
      client,
      opts.userId,
      opts.locale,
      opts.hours,
      settings.issuerName,
    );
    const { rows } = await client.query(
      `INSERT INTO attendance_certificates
         (code, user_id, variant, locale, source, override_reason, issued_by, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, variant) WHERE revoked_at IS NULL DO NOTHING
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
        WHERE user_id = $1 AND variant = $2 AND revoked_at IS NULL`,
      [opts.userId, opts.variant],
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
  },
): Promise<CertificateRow> {
  const eligibility = await eligibilityFor(input.userId);
  const overridden = !eligibility.eligible;
  if (overridden && !input.overrideReason) {
    throw reasonError(eligibility.reason ?? "not_available");
  }
  return insertCertificate({
    userId: input.userId,
    variant: input.variant,
    locale: input.locale,
    source: "staff",
    actorId,
    overrideReason: overridden ? input.overrideReason : null,
    hours: eligibility.hours,
  });
}

/** Issues the variant to everyone who meets the policy; already issued ones are skipped. */
export async function issueInBulk(
  actorId: number,
  variant: CertificateVariant,
  locale: CertificateLocale,
): Promise<{ issued: number; existing: number; skipped: number }> {
  const settings = await readSettings();
  if (settings.minHours == null) throw reasonError("not_available");
  const hoursByUser = await allHours();
  const demoed = settings.requiresDemo ? await demoedUsers(null) : new Set<number>();
  let issued = 0;
  let existing = 0;
  let skipped = 0;
  for (const person of hoursByUser) {
    const eligibility = evaluate(settings, person.hours, demoed.has(person.userId));
    if (!eligibility.eligible || !(await hasEventAccess(pool, person.userId))) {
      skipped++;
      continue;
    }
    const result = await insertCertificate({
      userId: person.userId,
      variant,
      locale,
      source: "bulk",
      actorId,
      hours: person.hours,
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

/** The certificate's owner, for access checks. */
export async function certificateOwner(id: number): Promise<number> {
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM attendance_certificates WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Certificate not found");
  return rows[0].user_id;
}

/** Renders the PDF from the stored snapshot; the DNI/NIE is read live. */
export async function renderCertificate(
  id: number,
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
  const pdf = await renderCertificatePdf({
    snapshot: row.snapshot as CertificateSnapshot,
    variant: row.variant,
    locale: row.locale,
    code: row.code,
    verifyUrl: `${config.WEB_URL.replace(/\/$/, "")}/verify/${row.code}`,
    issuedAt: row.issued_at,
    dni: row.dni ?? null,
  });
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
  /** Only the hours variant states hours. */
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
    hours: !revoked && row.variant === "hours" ? (snapshot.hours ?? null) : null,
  };
}
