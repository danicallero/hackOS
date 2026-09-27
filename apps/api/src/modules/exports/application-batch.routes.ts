import type { Readable } from "node:stream";
import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ZipArchive } from "archiver";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { getObject, objectExists } from "../../lib/storage.js";
import type { TemplateField } from "../applications/schemas.js";
import {
  APPLICATION_EXPORT_STATUSES,
  applicationExportBody,
  applicationExportCatalogQuery,
} from "./schemas.js";

type ExportLanguage = "es" | "gl" | "en";
type ExportDocumentScope = "none" | "all" | "shared";
type ApplicationExportStatus = (typeof APPLICATION_EXPORT_STATUSES)[number];

interface LocalizedText {
  en: string;
  es: string;
  gl: string;
}

interface StaticFieldDefinition {
  key: string;
  label: LocalizedText;
}

interface ApplicationDefinition {
  id: number;
  name: string;
  fields: Map<string, TemplateField>;
}

interface CatalogField {
  key: string;
  label: LocalizedText;
  kind: TemplateField["kind"];
  shareable_with_sponsors?: boolean;
}

interface NormalizedField {
  source: "profile" | "metadata" | "answer";
  key: string;
  applicationId?: number;
  label: LocalizedText;
  applicationName?: string;
  definition?: TemplateField;
  header: string;
}

interface ApplicationExportRow {
  response_id: number;
  user_id: number;
  application_id: number;
  application_name: string;
  application_granted_role_name: string | null;
  name: string | null;
  surname: string | null;
  email: string;
  secondary_email: string | null;
  dni: string | null;
  shirt_size: string | null;
  food_intolerances: string | null;
  food_intolerance_notes: string | null;
  dietary_data_state: string;
  university_id: number | null;
  language: string;
  user_notes: string | null;
  response_template: unknown;
  status: string;
  responses: Record<string, unknown>;
  staff_notes: string | null;
  created_at: Date;
  submitted_at: Date | null;
  decision_sent_at: Date | null;
  confirmed_at: Date | null;
  declined_at: Date | null;
}

interface DocumentCandidate {
  fileKey: string;
  responseId: number;
  userId: number;
  email: string;
  applicationId: number;
  fieldKey: string;
  archivePath: string;
}

interface LibraryValues {
  universities: Map<number, string>;
  degrees: Map<number, string>;
}

interface ExportFailure {
  responseId: number;
  userId: number;
  email: string;
  applicationId: number;
  fieldKey: string;
}

const MAX_FAILURES_IN_HEADER = 50;

const PROFILE_FIELDS: StaticFieldDefinition[] = [
  { key: "full_name", label: { en: "Full name", es: "Nombre completo", gl: "Nome completo" } },
  { key: "name", label: { en: "Name", es: "Nombre", gl: "Nome" } },
  { key: "surname", label: { en: "Surname", es: "Apellidos", gl: "Apelidos" } },
  { key: "email", label: { en: "Email", es: "Correo electrónico", gl: "Correo electrónico" } },
  {
    key: "secondary_email",
    label: { en: "Secondary email", es: "Correo secundario", gl: "Correo secundario" },
  },
  { key: "dni", label: { en: "DNI", es: "DNI", gl: "DNI" } },
  {
    key: "shirt_size",
    label: { en: "Shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
  },
  {
    key: "food_intolerances",
    label: {
      en: "Food intolerances",
      es: "Intolerancias alimentarias",
      gl: "Intolerancias alimentarias",
    },
  },
  {
    key: "food_intolerance_notes",
    label: {
      en: "Food intolerance notes",
      es: "Notas de intolerancias alimentarias",
      gl: "Notas de intolerancias alimentarias",
    },
  },
  {
    key: "dietary_data_state",
    label: {
      en: "Dietary data state",
      es: "Estado de datos alimentarios",
      gl: "Estado dos datos alimentarios",
    },
  },
  {
    key: "university_id",
    label: { en: "University ID", es: "ID de universidad", gl: "ID da universidade" },
  },
  { key: "language", label: { en: "Language", es: "Idioma", gl: "Idioma" } },
  { key: "notes", label: { en: "Profile notes", es: "Notas del perfil", gl: "Notas do perfil" } },
];

const METADATA_FIELDS: StaticFieldDefinition[] = [
  { key: "response_id", label: { en: "Response ID", es: "ID de respuesta", gl: "ID da resposta" } },
  { key: "user_id", label: { en: "User ID", es: "ID de usuario", gl: "ID de usuario" } },
  {
    key: "application_id",
    label: { en: "Application ID", es: "ID de application", gl: "ID da application" },
  },
  { key: "application_name", label: { en: "Application", es: "Application", gl: "Application" } },
  {
    key: "application_granted_role_name",
    label: { en: "Granted role", es: "Rol concedido", gl: "Rol concedido" },
  },
  { key: "status", label: { en: "Status", es: "Estado", gl: "Estado" } },
  { key: "created_at", label: { en: "Created at", es: "Creada el", gl: "Creada o" } },
  { key: "submitted_at", label: { en: "Submitted at", es: "Enviada el", gl: "Enviada o" } },
  {
    key: "decision_sent_at",
    label: { en: "Decision sent at", es: "Decisión enviada el", gl: "Decisión enviada o" },
  },
  { key: "confirmed_at", label: { en: "Confirmed at", es: "Confirmada el", gl: "Confirmada o" } },
  { key: "declined_at", label: { en: "Declined at", es: "Renuncia el", gl: "Renuncia o" } },
  {
    key: "staff_notes",
    label: { en: "Staff notes", es: "Notas del equipo", gl: "Notas do equipo" },
  },
];

interface ApplicationExportField {
  source: "profile" | "metadata" | "answer";
  key: string;
  application_id?: number;
}

interface ApplicationExportRequest {
  statuses: ApplicationExportStatus[];
  fields: ApplicationExportField[];
  application_ids?: number[];
  documents: ExportDocumentScope;
  language: ExportLanguage;
}

function asTemplate(value: unknown): TemplateField[] {
  return Array.isArray(value) ? (value as TemplateField[]) : [];
}

function pickText(text: LocalizedText, language: ExportLanguage): string {
  return text[language] || text.es || text.en || text.gl;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._@+-]+/g, "_").replace(/^\.+$/, "_");
}

function fileNameFromKey(key: string): string {
  return key.split("/").pop() || "upload";
}

function responseTemplate(row: ApplicationExportRow): TemplateField[] {
  return asTemplate(row.response_template);
}

function fieldFromResponse(row: ApplicationExportRow, key: string): TemplateField | undefined {
  return responseTemplate(row).find((field) => field.key === key);
}

function hasSponsorConsent(row: ApplicationExportRow, fieldKey: string): boolean {
  return row.responses[sponsorShareKey(fieldKey)] === true;
}

function fieldValueForProfile(row: ApplicationExportRow, key: string): unknown {
  switch (key) {
    case "full_name":
      return [row.name, row.surname].filter(Boolean).join(" ");
    case "name":
      return row.name;
    case "surname":
      return row.surname;
    case "email":
      return row.email;
    case "secondary_email":
      return row.secondary_email;
    case "dni":
      return row.dni;
    case "shirt_size":
      return row.shirt_size;
    case "food_intolerances":
      return [row.food_intolerances, row.food_intolerance_notes].filter(Boolean).join(", ");
    case "food_intolerance_notes":
      return row.food_intolerance_notes;
    case "dietary_data_state":
      return row.dietary_data_state;
    case "university_id":
      return row.university_id;
    case "language":
      return row.language;
    case "notes":
      return row.user_notes;
    default:
      return "";
  }
}

function fieldValueForMetadata(row: ApplicationExportRow, key: string): unknown {
  switch (key) {
    case "response_id":
      return row.response_id;
    case "user_id":
      return row.user_id;
    case "application_id":
      return row.application_id;
    case "application_name":
      return row.application_name;
    case "application_granted_role_name":
      return row.application_granted_role_name;
    case "status":
      return row.status;
    case "created_at":
      return row.created_at;
    case "submitted_at":
      return row.submitted_at;
    case "decision_sent_at":
      return row.decision_sent_at;
    case "confirmed_at":
      return row.confirmed_at;
    case "declined_at":
      return row.declined_at;
    case "staff_notes":
      return row.staff_notes;
    default:
      return "";
  }
}

function optionLabel(field: TemplateField, value: unknown, language: ExportLanguage): string {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      const option = (field.options ?? []).find((candidate) => candidate.value === String(item));
      return option ? pickText(option.label, language) : String(item ?? "");
    })
    .filter(Boolean)
    .join(", ");
}

function libraryId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return null;
}

function formatAnswer(
  row: ApplicationExportRow,
  field: TemplateField,
  language: ExportLanguage,
  documents: ExportDocumentScope,
  libraryValues: LibraryValues,
): unknown {
  const value = row.responses[field.key];
  if (value === null || value === undefined) return "";

  if (field.kind === "file") {
    if (typeof value !== "string") return "";
    if (
      documents === "shared" &&
      (!field.shareable_with_sponsors || !hasSponsorConsent(row, field.key))
    ) {
      return "";
    }
    return fileNameFromKey(value);
  }
  if (field.kind === "select" || field.kind === "multiselect") {
    return optionLabel(field, value, language);
  }
  if (field.kind === "university" || field.kind === "degree") {
    const id = libraryId(value);
    if (id === null) return String(value);
    return (
      (field.kind === "university"
        ? libraryValues.universities.get(id)
        : libraryValues.degrees.get(id)) ?? String(value)
    );
  }
  if (field.kind === "checkbox" && typeof value === "boolean") {
    return value
      ? { en: "Yes", es: "Sí", gl: "Si" }[language]
      : { en: "No", es: "No", gl: "Non" }[language];
  }
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function loadLibraryValues(
  rows: ApplicationExportRow[],
  fields: NormalizedField[],
): Promise<LibraryValues> {
  const universityIds = new Set<number>();
  const degreeIds = new Set<number>();

  for (const row of rows) {
    for (const field of fields) {
      if (field.source !== "answer") continue;
      const definition = fieldFromResponse(row, field.key) ?? field.definition;
      if (!definition) continue;
      const id = libraryId(row.responses[field.key]);
      if (id === null) continue;
      if (definition.kind === "university") universityIds.add(id);
      if (definition.kind === "degree") degreeIds.add(id);
    }
  }

  const [universities, degrees] = await Promise.all([
    universityIds.size
      ? pool.query<{ id: number; name: string }>(
          "SELECT id, name FROM universities WHERE id = ANY($1::integer[])",
          [[...universityIds]],
        )
      : Promise.resolve({ rows: [] as Array<{ id: number; name: string }> }),
    degreeIds.size
      ? pool.query<{ id: number; name: string }>(
          "SELECT id, name FROM university_degrees WHERE id = ANY($1::integer[])",
          [[...degreeIds]],
        )
      : Promise.resolve({ rows: [] as Array<{ id: number; name: string }> }),
  ]);

  return {
    universities: new Map(universities.rows.map(({ id, name }) => [id, name])),
    degrees: new Map(degrees.rows.map(({ id, name }) => [id, name])),
  };
}

async function loadApplicationDefinitions(
  applicationIds?: number[],
): Promise<ApplicationDefinition[]> {
  const { rows: applications } = await pool.query<{ id: number; name: string; template: unknown }>(
    `SELECT id, name, template FROM applications
      WHERE ($1::integer[] IS NULL OR id = ANY($1))
      ORDER BY id`,
    [applicationIds ?? null],
  );
  const definitions = applications.map((application) => ({
    id: application.id,
    name: application.name,
    fields: new Map(asTemplate(application.template).map((field) => [field.key, field])),
  }));
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  const { rows: versions } = await pool.query<{ application_id: number; template: unknown }>(
    `SELECT application_id, template
       FROM application_form_versions
      ORDER BY application_id, version DESC`,
  );
  for (const version of versions) {
    const definition = byId.get(version.application_id);
    if (!definition) continue;
    for (const field of asTemplate(version.template)) {
      // The current template wins for labels/kinds; old fields remain
      // selectable so a form edit never makes historical answers unreachable.
      if (!definition.fields.has(field.key)) definition.fields.set(field.key, field);
    }
  }
  return definitions;
}

function catalogField(field: TemplateField): CatalogField {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    ...(field.shareable_with_sponsors !== undefined
      ? { shareable_with_sponsors: field.shareable_with_sponsors }
      : {}),
  };
}

function normalizeFields(
  requestedFields: ApplicationExportField[],
  applications: ApplicationDefinition[],
  language: ExportLanguage,
): NormalizedField[] {
  const seen = new Set<string>();
  const applicationById = new Map(applications.map((application) => [application.id, application]));

  const fields = requestedFields.map((requested) => {
    const identifier = `${requested.source}:${requested.application_id ?? ""}:${requested.key}`;
    if (seen.has(identifier)) throw new BadRequestError("Export fields cannot be duplicated");
    seen.add(identifier);

    if (requested.source === "profile") {
      if (requested.application_id !== undefined) {
        throw new BadRequestError("Profile fields cannot include an application_id");
      }
      const definition = PROFILE_FIELDS.find((field) => field.key === requested.key);
      if (!definition) throw new BadRequestError(`Unknown profile field '${requested.key}'`);
      return {
        ...requested,
        label: definition.label,
        header: pickText(definition.label, language),
      };
    }

    if (requested.source === "metadata") {
      if (requested.application_id !== undefined) {
        throw new BadRequestError("Metadata fields cannot include an application_id");
      }
      const definition = METADATA_FIELDS.find((field) => field.key === requested.key);
      if (!definition) throw new BadRequestError(`Unknown metadata field '${requested.key}'`);
      return {
        ...requested,
        label: definition.label,
        header: pickText(definition.label, language),
      };
    }

    if (requested.application_id === undefined) {
      throw new BadRequestError("Answer fields require an application_id");
    }
    const application = applicationById.get(requested.application_id);
    const definition = application?.fields.get(requested.key);
    if (!application || !definition) {
      throw new BadRequestError(
        `Unknown answer field '${requested.key}' for application ${requested.application_id}`,
      );
    }
    const label = pickText(definition.label, language);
    return {
      ...requested,
      applicationId: application.id,
      applicationName: application.name,
      label: definition.label,
      definition,
      header: `${application.name} — ${label}`,
    };
  });

  const counts = new Map<string, number>();
  return fields.map((field) => {
    const count = (counts.get(field.header) ?? 0) + 1;
    counts.set(field.header, count);
    return count === 1 ? field : { ...field, header: `${field.header} (${count})` };
  });
}

async function loadApplicationRows(
  statuses: readonly string[],
  language: ExportLanguage,
  applicationIds?: number[],
): Promise<ApplicationExportRow[]> {
  const { rows } = await pool.query<ApplicationExportRow>(
    `SELECT r.id AS response_id,
            r.user_id,
            r.application_id,
            app.name AS application_name,
            (SELECT role_name.name
               FROM application_grants_roles agr
               JOIN roles role_name ON role_name.id = agr.role_id AND role_name.deleted_at IS NULL
              WHERE agr.application_id = app.id
              ORDER BY role_name.position DESC
              LIMIT 1) AS application_granted_role_name,
            u.name,
            u.surname,
            u.email,
            u.secondary_email,
            u.dni,
            u.shirt_size,
            COALESCE((SELECT string_agg(
                              COALESCE(fi.label ->> $2, fi.label ->> 'en'),
                              ', ' ORDER BY fi.id)
                        FROM unnest(u.food_intolerances) AS intolerance(id)
                        JOIN food_intolerances fi ON fi.id = intolerance.id), '') AS food_intolerances,
            u.food_intolerance_notes,
            u.dietary_data_state,
            u.university_id,
            u.language,
            u.notes AS user_notes,
            fv.template AS response_template,
            r.status,
            r.responses,
            u.notes AS staff_notes,
            r.created_at,
            r.submitted_at,
            r.decision_sent_at,
            r.confirmed_at,
            r.declined_at
       FROM application_responses r
       JOIN applications app ON app.id = r.application_id
       JOIN application_form_versions fv ON fv.id = r.application_form_version_id
       JOIN users u ON u.id = r.user_id
      WHERE r.status = ANY($1::app_response_status[])
        AND ($3::integer[] IS NULL OR r.application_id = ANY($3))
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL
        AND u.is_test_account = false
      ORDER BY r.id`,
    [statuses, language, applicationIds ?? null],
  );
  return rows;
}

async function buildRows(
  rows: ApplicationExportRow[],
  fields: NormalizedField[],
  language: ExportLanguage,
  documents: ExportDocumentScope,
): Promise<unknown[][]> {
  const libraryValues = await loadLibraryValues(rows, fields);
  return rows.map((row) =>
    fields.map((field) => {
      if (field.source === "profile") return fieldValueForProfile(row, field.key);
      if (field.source === "metadata") return fieldValueForMetadata(row, field.key);
      const definition = fieldFromResponse(row, field.key) ?? field.definition;
      return definition ? formatAnswer(row, definition, language, documents, libraryValues) : "";
    }),
  );
}

function documentsForRows(
  rows: ApplicationExportRow[],
  scope: Exclude<ExportDocumentScope, "none">,
): DocumentCandidate[] {
  const candidates: DocumentCandidate[] = [];
  for (const row of rows) {
    for (const field of responseTemplate(row)) {
      if (field.kind !== "file") continue;
      if (
        scope === "shared" &&
        (!field.shareable_with_sponsors || !hasSponsorConsent(row, field.key))
      ) {
        continue;
      }
      const fileKey = row.responses[field.key];
      if (typeof fileKey !== "string" || fileKey.length === 0) continue;
      const originalName = safeSegment(fileNameFromKey(fileKey));
      const archivePath =
        `documents/application-${row.application_id}/` +
        `${row.response_id}-${safeSegment(row.email)}/` +
        `${safeSegment(field.key)}-${originalName}`;
      candidates.push({
        fileKey,
        responseId: row.response_id,
        userId: row.user_id,
        email: row.email,
        applicationId: row.application_id,
        fieldKey: field.key,
        archivePath,
      });
    }
  }
  return candidates;
}

/** H56: configurable multi-application export. The response CSV is selected
 *  column-by-column and the optional documents folder applies the same
 *  applicant-consent rule as the per-field file export. */
export function registerApplicationBatchExportRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/api/exports/applications/catalog",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        summary: "List fields available to the batch application export",
        description:
          "Returns profile, response metadata, and every field from the current or immutable historical form versions. Pass application_id to list one form's columns. The endpoint is gated by exports:run because it exposes the export shape, including fields whose files may be shareable with sponsors (H54/H56).",
        querystring: applicationExportCatalogQuery,
      },
    },
    async (req, reply) => {
      const applicationIds = req.query.application_id ? [req.query.application_id] : undefined;
      const applications = await loadApplicationDefinitions(applicationIds);
      return reply.send({
        profile: PROFILE_FIELDS,
        metadata: METADATA_FIELDS,
        applications: applications.map((application) => ({
          id: application.id,
          name: application.name,
          fields: [...application.fields.values()].map(catalogField),
        })),
      });
    },
  );

  typed.post(
    "/api/exports/applications.zip",
    {
      preHandler: requireCapability(CAPABILITIES.EXPORTS_RUN),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.EXPORTS_RUN }),
      schema: {
        summary: "Export selected application responses and documents",
        description:
          "Streams a ZIP containing applications.csv with the requested statuses and columns. Library-backed university and degree answers are exported as their catalogue names, not stored IDs. `documents=all` includes every saved file from each response's immutable form snapshot. `documents=shared` includes only file fields marked shareable_with_sponsors where the applicant explicitly consented with the corresponding sponsor-share response value (H13/H14/H54/H56). Missing objects are omitted, audited per response, and reported in x-export-file-failures.",
        body: applicationExportBody,
      },
    },
    async (req, reply) => {
      const body = req.body as ApplicationExportRequest;
      const uniqueStatuses = [...new Set(body.statuses)];
      if (uniqueStatuses.length !== body.statuses.length) {
        throw new BadRequestError("Export statuses cannot be duplicated");
      }
      // Keep this check close to the route so a future schema change cannot
      // silently widen the SQL enum cast below.
      if (uniqueStatuses.some((status) => !APPLICATION_EXPORT_STATUSES.includes(status))) {
        throw new BadRequestError("Unknown application response status");
      }
      const applicationIds = body.application_ids && [...new Set(body.application_ids)];
      if (applicationIds && applicationIds.length !== body.application_ids?.length) {
        throw new BadRequestError("Application selections cannot be duplicated");
      }

      const applications = await loadApplicationDefinitions(applicationIds);
      const fields = normalizeFields(body.fields, applications, body.language);
      const rows = await loadApplicationRows(uniqueStatuses, body.language, applicationIds);
      const csvRows = await buildRows(rows, fields, body.language, body.documents);
      const headers = fields.map((field) => field.header);

      const documents = body.documents === "none" ? [] : documentsForRows(rows, body.documents);
      const readableDocuments: DocumentCandidate[] = [];
      const failures: ExportFailure[] = [];
      for (const document of documents) {
        if (await objectExists(document.fileKey)) {
          readableDocuments.push(document);
        } else {
          failures.push({
            responseId: document.responseId,
            userId: document.userId,
            email: document.email,
            applicationId: document.applicationId,
            fieldKey: document.fieldKey,
          });
        }
      }

      for (const failure of failures) {
        await audit(pool, {
          actorId: req.userId,
          entityType: "application_response",
          entityId: failure.responseId,
          action: "export_file_unreadable",
          reason: `Field '${failure.fieldKey}' upload missing from storage during batch export`,
        });
      }
      await audit(pool, {
        actorId: req.userId,
        entityType: "application_batch_export",
        entityId: "applications",
        action: "export",
        after: {
          statuses: uniqueStatuses,
          application_ids: applicationIds,
          fields: body.fields,
          documents: body.documents,
          response_count: rows.length,
          document_count: readableDocuments.length,
          failed_document_count: failures.length,
        },
      });

      reply.header("content-type", "application/zip");
      reply.header("content-disposition", 'attachment; filename="applications-export.zip"');
      reply.header("cache-control", "private, no-store");
      if (failures.length > 0) {
        reply.header(
          "x-export-file-failures",
          JSON.stringify({
            total: failures.length,
            items: failures.slice(0, MAX_FAILURES_IN_HEADER),
          }),
        );
      }

      const archive = new ZipArchive({ zlib: { level: 9 } });
      const sent = reply.send(archive);
      try {
        const csv = `${[headers.join(","), ...csvRows.map((row) => row.map(csvCell).join(","))].join("\r\n")}\r\n`;
        archive.append(csv, { name: "applications.csv" });
        for (const document of readableDocuments) {
          try {
            const object = await getObject(document.fileKey);
            if (object.Body)
              archive.append(object.Body as Readable, { name: document.archivePath });
          } catch (error) {
            req.log.warn(
              { error, fileKey: document.fileKey, responseId: document.responseId },
              "application-batch-export: skipped a file that could not be read",
            );
          }
        }
        await archive.finalize();
      } catch (error) {
        req.log.error({ error }, "application-batch-export: failed to finalize the zip");
      }
      return sent;
    },
  );
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
