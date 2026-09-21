import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { recordsToCsv, toCsv } from "../../lib/csv.js";
import { BadRequestError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { activitiesExportBody, activitiesExportCatalogQuery } from "./schemas.js";

type ExportLanguage = "es" | "gl" | "en";
type ActivityExportMode = "people" | "scans";

interface LocalizedMap {
  [language: string]: string | null | undefined;
}

interface ActivityCatalogRow {
  id: number;
  name: string;
  category: string;
  requires_scan: boolean;
  primary_language: ExportLanguage;
  name_i18n: LocalizedMap | null;
  description_i18n: LocalizedMap | null;
  starts_at: Date | null;
  ends_at: Date | null;
  scan_count: number;
  distinct_people: number;
}

function localizedText(
  fallback: string,
  translations: LocalizedMap | null | undefined,
  language: ExportLanguage,
  primaryLanguage?: ExportLanguage | null,
): string {
  for (const key of [language, primaryLanguage, "en", "es", "gl"]) {
    const value = key ? translations?.[key] : undefined;
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  reply.header("cache-control", "private, no-store");
  return reply.send(csv);
}

const SCANNABLE_ACTIVITY_WHERE = "(a.category = ANY($1::text[]) OR a.requires_scan = true)";

async function loadActivityCatalog(language: ExportLanguage): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<ActivityCatalogRow>(
    `SELECT a.id, a.name, a.category, a.requires_scan, a.primary_language,
            a.name_i18n, a.description_i18n,
            s.starts_at, s.ends_at,
            count(al.id)::int AS scan_count,
            count(DISTINCT u.id)::int AS distinct_people
       FROM activities a
       LEFT JOIN activity_logs al ON al.activity_id = a.id
       LEFT JOIN users u ON u.id = al.user_id
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = false
       LEFT JOIN schedule s ON s.id = a.schedule_id
      WHERE ${SCANNABLE_ACTIVITY_WHERE}
      GROUP BY a.id, a.name, a.category, a.requires_scan, a.primary_language,
               a.name_i18n, a.description_i18n, s.starts_at, s.ends_at
      ORDER BY s.starts_at ASC NULLS LAST, a.name ASC, a.id ASC`,
    [[...MEAL_ACTIVITY_KINDS]],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: localizedText(row.name, row.name_i18n, language, row.primary_language),
    category: row.category,
    requires_scan: row.requires_scan,
    starts_at: row.starts_at?.toISOString() ?? null,
    ends_at: row.ends_at?.toISOString() ?? null,
    scan_count: Number(row.scan_count),
    distinct_people: Number(row.distinct_people),
  }));
}

async function validateActivityIds(activityIds: number[]): Promise<number[]> {
  const uniqueIds = [...new Set(activityIds)];
  if (uniqueIds.length !== activityIds.length) {
    throw new BadRequestError("Activity selections cannot be duplicated");
  }

  const { rows } = await pool.query<{ id: number }>(
    `SELECT a.id
       FROM activities a
      WHERE a.id = ANY($1::int[])
        AND (a.category = ANY($2::text[]) OR a.requires_scan = true)`,
    [uniqueIds, [...MEAL_ACTIVITY_KINDS]],
  );
  const found = new Set(rows.map((row) => Number(row.id)));
  const invalid = uniqueIds.filter((id) => !found.has(id));
  if (invalid.length > 0) {
    throw new BadRequestError("One or more selected activities cannot be exported", {
      activityIds: invalid,
    });
  }
  return uniqueIds;
}

async function exportActivityCsv(
  activityIds: number[],
  mode: ActivityExportMode,
  language: ExportLanguage,
): Promise<string> {
  if (mode === "people") {
    const { rows } = await pool.query(
      `SELECT a.id AS activity_id, a.name AS activity_name, a.category AS activity_category,
              a.primary_language, a.name_i18n,
              s.starts_at, s.ends_at,
              u.id AS user_id, u.name, u.surname, u.email, u.dni,
              count(al.id)::int AS attendance_count,
              min(al.logged_at) AS first_attended_at,
              max(al.logged_at) AS last_attended_at
         FROM activity_logs al
         JOIN activities a ON a.id = al.activity_id
         JOIN users u ON u.id = al.user_id
         LEFT JOIN schedule s ON s.id = a.schedule_id
        WHERE al.activity_id = ANY($1::int[])
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND u.is_test_account = false
        GROUP BY a.id, a.name, a.category, a.primary_language, a.name_i18n,
                 s.starts_at, s.ends_at, u.id, u.name, u.surname, u.email, u.dni
        ORDER BY a.id, u.surname NULLS LAST, u.name NULLS LAST, u.id`,
      [activityIds],
    );
    const header = [
      "activity_id",
      "activity_name",
      "activity_category",
      "activity_starts_at",
      "activity_ends_at",
      "user_id",
      "name",
      "surname",
      "email",
      "dni",
      "attendance_count",
      "first_attended_at",
      "last_attended_at",
    ];
    return toCsv(
      header,
      recordsToCsv(
        header,
        rows.map((row) => ({
          activity_id: row.activity_id,
          activity_name: localizedText(
            row.activity_name,
            row.name_i18n,
            language,
            row.primary_language,
          ),
          activity_category: row.activity_category,
          activity_starts_at: row.starts_at,
          activity_ends_at: row.ends_at,
          user_id: row.user_id,
          name: row.name,
          surname: row.surname,
          email: row.email,
          dni: row.dni,
          attendance_count: row.attendance_count,
          first_attended_at: row.first_attended_at,
          last_attended_at: row.last_attended_at,
        })),
      ),
    );
  }

  const { rows } = await pool.query(
    `SELECT al.id AS scan_id, a.id AS activity_id, a.name AS activity_name,
            a.category AS activity_category, a.primary_language, a.name_i18n,
            u.id AS user_id, u.name, u.surname, u.email, u.dni,
            al.logged_at, al.logged_by, actor.name AS logged_by_name,
            actor.surname AS logged_by_surname, al.notes,
            al.source_device_id, al.source_scan_id
       FROM activity_logs al
       JOIN activities a ON a.id = al.activity_id
       JOIN users u ON u.id = al.user_id
       LEFT JOIN users actor ON actor.id = al.logged_by
      WHERE al.activity_id = ANY($1::int[])
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = false
      ORDER BY al.logged_at, al.id`,
    [activityIds],
  );
  const header = [
    "scan_id",
    "activity_id",
    "activity_name",
    "activity_category",
    "user_id",
    "name",
    "surname",
    "email",
    "dni",
    "logged_at",
    "logged_by",
    "logged_by_name",
    "logged_by_surname",
    "notes",
    "source_device_id",
    "source_scan_id",
  ];
  return toCsv(
    header,
    recordsToCsv(
      header,
      rows.map((row) => ({
        scan_id: row.scan_id,
        activity_id: row.activity_id,
        activity_name: localizedText(
          row.activity_name,
          row.name_i18n,
          language,
          row.primary_language,
        ),
        activity_category: row.activity_category,
        user_id: row.user_id,
        name: row.name,
        surname: row.surname,
        email: row.email,
        dni: row.dni,
        logged_at: row.logged_at,
        logged_by: row.logged_by,
        logged_by_name: row.logged_by_name,
        logged_by_surname: row.logged_by_surname,
        notes: row.notes,
        source_device_id: row.source_device_id,
        source_scan_id: row.source_scan_id,
      })),
    ),
  );
}

async function exportPresenceLogCsv(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT tl.id AS log_id, tl.kind AS event, tl.scanned_at,
            u.id AS user_id, u.name, u.surname, u.email, u.dni, u.badge_id,
            tl.scanned_by, actor.name AS scanned_by_name,
            actor.surname AS scanned_by_surname, actor.email AS scanned_by_email,
            tl.notes
       FROM time_logs tl
       JOIN users u ON u.id = tl.user_id
       LEFT JOIN users actor ON actor.id = tl.scanned_by
      WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = false
      ORDER BY tl.scanned_at, tl.id`,
  );
  const header = [
    "log_id",
    "event",
    "scanned_at",
    "user_id",
    "name",
    "surname",
    "email",
    "dni",
    "badge_id",
    "scanned_by",
    "scanned_by_name",
    "scanned_by_surname",
    "scanned_by_email",
    "notes",
  ];
  return toCsv(header, recordsToCsv(header, rows as Record<string, unknown>[]));
}

/** H54: configurable activity attendance and raw presence-register exports. */
export function registerLogisticsExportRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/exports/activities/catalog",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        querystring: activitiesExportCatalogQuery,
        summary: "List activities available for attendance export",
        description:
          "Returns all meal and requires_scan activities with schedule and attendance counts so the export page can offer a searchable selection.",
      },
    },
    async (req) => ({ activities: await loadActivityCatalog(req.query.language) }),
  );

  typed.post(
    "/api/exports/activities.csv",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        body: activitiesExportBody,
        summary: "Export attendance for selected activities",
        description:
          "`mode=people` returns one row per person and selected activity with first/last attendance and repeat count. `mode=scans` returns the raw activity scans. Test, anonymized and inactive subjects are excluded.",
      },
    },
    async (req, reply) => {
      const activityIds = await validateActivityIds(req.body.activity_ids);
      const csv = await exportActivityCsv(activityIds, req.body.mode, req.body.language);
      await audit(pool, {
        actorId: req.userId,
        entityType: "activity_export",
        entityId: "selected",
        action: "export",
        after: { activity_ids: activityIds, mode: req.body.mode },
      });
      return sendCsv(
        reply,
        req.body.mode === "people" ? "activity-attendance.csv" : "activity-scans.csv",
        csv,
      );
    },
  );

  typed.get(
    "/api/exports/presence-log.csv",
    {
      preHandler: requireCapability(CAPABILITIES.LOGISTICS_STATS),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.LOGISTICS_STATS }),
      schema: {
        summary: "Export the raw presence register",
        description:
          "Exports every active, non-test subject's in/out presence signal with its operator, timestamp, badge and notes. Requires logistics:stats because it contains contact fields for the full roster.",
      },
    },
    async (_req, reply) => {
      const csv = await exportPresenceLogCsv();
      await audit(pool, {
        actorId: _req.userId,
        entityType: "presence_export",
        entityId: "register",
        action: "export",
      });
      return sendCsv(reply, "presence-register.csv", csv);
    },
  );
}
