import type pg from "pg";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";

const translations = z.object({
  es: z.string().trim().min(1).max(500),
  gl: z.string().trim().min(1).max(500),
  en: z.string().trim().min(1).max(500),
});
const bodies = z.object({
  es: z.string().trim().min(1).max(12000),
  gl: z.string().trim().min(1).max(12000),
  en: z.string().trim().min(1).max(12000),
});
export const typeInputSchema = z
  .object({
    name: translations,
    title: translations,
    body: bodies.nullable(),
    enabled: z.boolean(),
    attendancePolicy: z.boolean(),
    selfService: z.boolean(),
    audienceRoleIds: z.array(z.number().int().positive()).max(200).nullable(),
    allowGuests: z.boolean(),
    identityPolicy: z.enum(["none", "optional", "required"]),
    requiresActivity: z.boolean(),
    /** Self-service and bulk issue wait until the event has ended. */
    requiresEventEnd: z.boolean(),
    demoRequirement: z.enum(["none", "any", "mandatory", "challenge"]),
    demoChallengeId: z.number().int().positive().nullable(),
    /** Holders of these roles skip every requirement of this type. */
    exemptRoleIds: z.array(z.number().int().positive()).max(200).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.demoRequirement === "challenge") !== (v.demoChallengeId !== null))
      ctx.addIssue({
        code: "custom",
        path: ["demoChallengeId"],
        message: "Choose a challenge exactly when the requirement is a specific jury",
      });
    if (v.selfService && v.requiresActivity)
      ctx.addIssue({
        code: "custom",
        path: ["selfService"],
        message: "Self-service cannot require a speaker activity",
      });
    for (const body of Object.values(v.body ?? {})) {
      for (const token of body.matchAll(/\{([^{}]+)\}/g))
        if (
          !["recipient", "event", "issuer", "activity", "hours", "dates", "venue"].includes(
            token[1] ?? "",
          )
        )
          ctx.addIssue({
            code: "custom",
            path: ["body"],
            message: `Unknown certificate field: ${token[1]}`,
          });
    }
  });
export type CertificateTypeInput = z.infer<typeof typeInputSchema>;
export interface CertificateType extends CertificateTypeInput {
  id: number;
  revision: number;
  legacyVariant: "participation" | "hours" | "activities" | "accepted_spot" | null;
}
function rowType(r: Record<string, unknown>): CertificateType {
  return {
    id: r.id as number,
    revision: r.revision as number,
    legacyVariant: r.legacy_variant as CertificateType["legacyVariant"],
    name: r.name_i18n as CertificateType["name"],
    title: r.title_i18n as CertificateType["title"],
    body: r.body_i18n as CertificateType["body"],
    enabled: r.enabled as boolean,
    attendancePolicy: r.attendance_policy as boolean,
    selfService: r.self_service as boolean,
    audienceRoleIds: r.audience_role_ids as number[] | null,
    allowGuests: r.allow_guests as boolean,
    identityPolicy: r.identity_policy as CertificateType["identityPolicy"],
    requiresActivity: r.requires_activity as boolean,
    requiresEventEnd: r.requires_event_end as boolean,
    demoRequirement: r.demo_requirement as CertificateType["demoRequirement"],
    demoChallengeId: r.demo_challenge_id as number | null,
    exemptRoleIds: r.exempt_role_ids as number[] | null,
  };
}
export async function listCertificateTypes(
  db: pg.Pool | pg.PoolClient = pool,
): Promise<CertificateType[]> {
  const { rows } = await db.query(`SELECT * FROM certificate_types ORDER BY id`);
  return rows.map(rowType);
}
export async function readCertificateType(
  id: number | undefined,
  variant?: string,
  db: pg.Pool | pg.PoolClient = pool,
  lock = false,
): Promise<CertificateType> {
  const { rows } = await db.query(
    `SELECT * FROM certificate_types WHERE ${id == null ? "legacy_variant=$1" : "id=$1"}${lock ? " FOR SHARE" : ""}`,
    [id ?? variant],
  );
  if (!rows[0]) throw new NotFoundError("Certificate type not found");
  return rowType(rows[0]);
}
/** The person's live role ids, read once so several types can be checked without a query each. */
export async function activeRoleIds(
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
): Promise<Set<number>> {
  const { rows } = await db.query<{ role_id: number }>(
    `SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.deleted_at IS NULL`,
    [userId],
  );
  return new Set(rows.map((row) => row.role_id));
}
export async function recipientMatchesType(
  type: CertificateType,
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
  self = false,
  roleIds?: ReadonlySet<number>,
): Promise<boolean> {
  if (!type.enabled || (self && !type.selfService)) return false;
  if ((self || type.legacyVariant === "accepted_spot") && !(await hasEventAccess(db, userId)))
    return false;
  if (type.audienceRoleIds == null) return true;
  if (roleIds) return type.audienceRoleIds.some((id) => roleIds.has(id));
  const { rowCount } = await db.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.id=ANY($2::int[]) AND r.deleted_at IS NULL LIMIT 1`,
    [userId, type.audienceRoleIds],
  );
  return Boolean(rowCount);
}
/** Holders of an exempt role skip this type's attendance, event-end and presentation requirements. */
export async function isExemptRecipient(
  type: CertificateType,
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
  roleIds?: ReadonlySet<number>,
): Promise<boolean> {
  if (!type.exemptRoleIds?.length) return false;
  if (roleIds) return type.exemptRoleIds.some((id) => roleIds.has(id));
  const { rowCount } = await db.query(
    `SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.id=ANY($2::int[]) AND r.deleted_at IS NULL LIMIT 1`,
    [userId, type.exemptRoleIds],
  );
  return Boolean(rowCount);
}
export async function assertTypeRecipient(
  type: CertificateType,
  userId: number,
  db: pg.Pool | pg.PoolClient = pool,
  self = false,
) {
  if (!(await recipientMatchesType(type, userId, db, self)))
    throw new ForbiddenError("This certificate type is not available to this recipient");
}
export async function saveCertificateType(
  actorId: number,
  input: CertificateTypeInput,
  id?: number,
  revision?: number,
): Promise<CertificateType> {
  return withTransaction(async (client) => {
    let before: CertificateType | null = null;
    if (id != null) {
      const { rows } = await client.query(
        `SELECT * FROM certificate_types WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundError("Certificate type not found");
      before = rowType(rows[0]);
      if (revision !== before.revision)
        throw new ConflictError("This certificate type changed; reload before saving");
    }
    if (
      before?.legacyVariant === "accepted_spot" &&
      (input.attendancePolicy ||
        !input.selfService ||
        input.audienceRoleIds !== null ||
        input.allowGuests ||
        input.requiresActivity ||
        input.requiresEventEnd ||
        input.demoRequirement !== "none" ||
        input.exemptRoleIds !== null ||
        input.body == null)
    )
      throw new BadRequestError("Accepted spot certificates are for everyone with event access");
    if (!before?.legacyVariant && input.body == null)
      throw new BadRequestError("Custom certificates require text in every language");
    if (input.audienceRoleIds?.length) {
      const { rows } = await client.query(
        `SELECT id FROM roles WHERE id=ANY($1::int[]) AND deleted_at IS NULL`,
        [input.audienceRoleIds],
      );
      if (rows.length !== new Set(input.audienceRoleIds).size)
        throw new BadRequestError("One of the recipient roles no longer exists");
    }
    if (input.exemptRoleIds?.length) {
      const { rows } = await client.query(
        `SELECT id FROM roles WHERE id=ANY($1::int[]) AND deleted_at IS NULL`,
        [input.exemptRoleIds],
      );
      if (rows.length !== new Set(input.exemptRoleIds).size)
        throw new BadRequestError("One of the exempt roles no longer exists");
    }
    if (input.demoChallengeId != null) {
      const { rowCount } = await client.query(`SELECT 1 FROM challenges WHERE id=$1`, [
        input.demoChallengeId,
      ]);
      if (!rowCount) throw new BadRequestError("The required challenge no longer exists");
    }
    const params = [
      JSON.stringify(input.name),
      JSON.stringify(input.title),
      input.body == null ? null : JSON.stringify(input.body),
      input.enabled,
      input.attendancePolicy,
      input.selfService,
      input.audienceRoleIds,
      input.allowGuests,
      input.identityPolicy,
      input.requiresActivity,
      input.requiresEventEnd,
      input.demoRequirement,
      input.demoChallengeId,
      input.exemptRoleIds,
    ];
    const { rows } =
      id == null
        ? await client.query(
            `INSERT INTO certificate_types(name_i18n,title_i18n,body_i18n,enabled,attendance_policy,self_service,audience_role_ids,allow_guests,identity_policy,requires_activity,requires_event_end,demo_requirement,demo_challenge_id,exempt_role_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            params,
          )
        : await client.query(
            `UPDATE certificate_types SET name_i18n=$1,title_i18n=$2,body_i18n=$3,enabled=$4,attendance_policy=$5,self_service=$6,audience_role_ids=$7,allow_guests=$8,identity_policy=$9,requires_activity=$10,requires_event_end=$11,demo_requirement=$12,demo_challenge_id=$13,exempt_role_ids=$14,revision=revision+1 WHERE id=$15 RETURNING *`,
            [...params, id],
          );
    const after = rowType(rows[0]);
    await audit(client, {
      actorId,
      entityType: "certificate_type",
      entityId: after.id,
      action: id == null ? "certificate_type.create" : "certificate_type.update",
      before,
      after,
    });
    return after;
  });
}
