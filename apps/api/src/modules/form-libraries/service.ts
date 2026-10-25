import { randomUUID } from "node:crypto";
import type { TemplateField } from "@hackos/shared/forms";
import type { Queryable } from "../../db/pool.js";
import { BadRequestError, ConflictError } from "../../lib/errors.js";

/** H11/H16: called inside the form's save transaction, after locking its owner. */
export async function syncFieldLibraries(
  db: Queryable,
  applicationId: number | null,
  fields: TemplateField[],
  confirmed: string[] = [],
) {
  const project = applicationId === null;
  const { rows } = await db.query(
    `SELECT id,field_key FROM form_libraries WHERE application_id IS NOT DISTINCT FROM $1 AND project=$2 FOR UPDATE`,
    [applicationId, project],
  );
  const kept = fields
    .filter((field) => field.kind === "library" && field.library_id)
    .map((field) => field.library_id);
  if (kept.some((id) => !rows.some((row) => row.id === id)))
    throw new BadRequestError("Library does not belong to this form");
  const removed = rows.filter((row) => !kept.includes(row.id));
  if (removed.some((row) => !confirmed.includes(row.id)))
    throw new ConflictError("Confirm deletion of the field library and all its values");
  if (removed.length) {
    const keys = removed.map((row) => row.field_key);
    if (project)
      await db.query(
        `UPDATE repos SET responses=responses-$1::text[],draft_revision=draft_revision+1 WHERE responses ?| $1::text[]`,
        [keys],
      );
    else
      await db.query(
        `UPDATE application_responses SET responses=responses-$1::text[] WHERE application_id=$2 AND status='draft' AND responses ?| $1::text[]`,
        [keys, applicationId],
      );
    await db.query(`DELETE FROM form_libraries WHERE id=ANY($1::uuid[])`, [
      removed.map((row) => row.id),
    ]);
  }
  if (kept.length)
    await db.query(`UPDATE form_libraries SET field_key=id::text WHERE id=ANY($1::uuid[])`, [kept]);
  const result: TemplateField[] = [];
  for (const field of fields) {
    if (field.kind !== "library") {
      const { library_id: _library, ...rest } = field;
      result.push(rest);
      continue;
    }
    if (field.library_id && !rows.some((row) => row.id === field.library_id))
      throw new BadRequestError("Library does not belong to this form");
    const id = field.library_id ?? randomUUID();
    if (!field.library_id)
      await db.query(
        `INSERT INTO form_libraries(id,application_id,project,field_key) VALUES($1,$2,$3,$4)`,
        [id, applicationId, project, field.key],
      );
    else await db.query(`UPDATE form_libraries SET field_key=$2 WHERE id=$1`, [id, field.key]);
    result.push({ ...field, library_id: id });
  }
  return result;
}

/** H11/H16: curating a name updates working answers; immutable submissions retain original text. */
export async function replaceLibraryAnswers(
  db: Queryable,
  library: {
    id: string;
    project: boolean;
    application_id: number | null;
    field_key: string;
    fixture: boolean;
  },
  source: string,
  target: string | null,
) {
  const parameters = [library.field_key, source, target];
  const expression = `jsonb_set(responses, ARRAY[$1::text], COALESCE((SELECT jsonb_agg(DISTINCT CASE WHEN value=$2 THEN to_jsonb($3::text) ELSE to_jsonb(value) END) FROM jsonb_array_elements_text(responses->$1) value WHERE value<>$2 OR $3::text IS NOT NULL),'[]'::jsonb))`;
  if (library.project)
    await db.query(
      `UPDATE repos SET responses=${expression},draft_revision=draft_revision+1 WHERE jsonb_typeof(responses->$1)='array' AND responses->$1 ? $2 AND is_test_account=$4`,
      [...parameters, library.fixture],
    );
  else
    await db.query(
      `WITH owned_fields AS (
        SELECT r.id,field->>'key' AS field_key FROM application_responses r
        JOIN application_form_versions version ON version.id=r.application_form_version_id
        CROSS JOIN LATERAL jsonb_array_elements(version.template) field
        WHERE r.application_id=$4 AND r.status='draft' AND field->>'library_id'=$3
          AND EXISTS(SELECT 1 FROM users u WHERE u.id=r.user_id AND u.is_test_account=$5)
      ) UPDATE application_responses r SET responses=jsonb_set(r.responses,ARRAY[owned_fields.field_key],
        COALESCE((SELECT jsonb_agg(DISTINCT CASE WHEN value=$1 THEN to_jsonb($2::text) ELSE to_jsonb(value) END)
          FROM jsonb_array_elements_text(r.responses->owned_fields.field_key) value WHERE value<>$1 OR $2::text IS NOT NULL),'[]'::jsonb))
        FROM owned_fields WHERE r.id=owned_fields.id AND jsonb_typeof(r.responses->owned_fields.field_key)='array' AND r.responses->owned_fields.field_key ? $1`,
      [source, target, library.id, library.application_id, library.fixture],
    );
}

/** H11/H16: accepting answers never creates catalogue entries implicitly. */
export async function validateLibraryAnswers(
  db: Queryable,
  fields: TemplateField[],
  responses: Record<string, unknown>,
  userId: number,
) {
  const libraryIds = [
    ...new Set(
      fields.flatMap((field) =>
        field.kind === "library" && field.library_id && responses[field.key] != null
          ? [field.library_id]
          : [],
      ),
    ),
  ];
  // One lookup for every library instead of two per field.
  const existing = new Set<string>();
  const namesByLibrary = new Map<string, Set<string>>();
  if (libraryIds.length) {
    const { rows: libraries } = await db.query(
      `SELECT id FROM form_libraries WHERE id=ANY($1::uuid[])`,
      [libraryIds],
    );
    for (const row of libraries) existing.add(row.id as string);
    const { rows: valueRows } = await db.query(
      `SELECT library_id, name FROM form_library_values WHERE library_id=ANY($1::uuid[]) AND is_test_account=(SELECT is_test_account FROM users WHERE id=$2)`,
      [libraryIds, userId],
    );
    for (const row of valueRows) {
      const names = namesByLibrary.get(row.library_id as string) ?? new Set<string>();
      names.add(row.name as string);
      namesByLibrary.set(row.library_id as string, names);
    }
  }
  for (const field of fields) {
    if (field.kind !== "library" || !field.library_id || responses[field.key] == null) continue;
    const answers = responses[field.key];
    if (!Array.isArray(answers) || answers.some((value) => typeof value !== "string"))
      throw new BadRequestError("Invalid library answer");
    if (!existing.has(field.library_id)) continue; // Historical form versions retain answers after their catalogue is retired.
    const names = namesByLibrary.get(field.library_id);
    if (answers.some((value) => !names?.has(value)))
      throw new ConflictError("Library values have changed; reload the form");
  }
}

/** H11: retiring a required catalogue must not strand a draft on an unanswerable question. */
export async function activeLibraryFields(db: Queryable, fields: TemplateField[]) {
  const ids = fields.flatMap((field) =>
    field.kind === "library" && field.library_id ? [field.library_id] : [],
  );
  if (!ids.length) return fields;
  const { rows } = await db.query(`SELECT id FROM form_libraries WHERE id=ANY($1::uuid[])`, [ids]);
  return fields.filter(
    (field) =>
      field.kind !== "library" ||
      !field.library_id ||
      rows.some((row) => row.id === field.library_id),
  );
}
