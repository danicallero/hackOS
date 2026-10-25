// A person's university is the library answer on their newest application
// response that has a `university` field; the profile carries no copy of it
// (H12). Interpolate the scalar subquery wherever a university id is needed.

/** SQL scalar subquery: university id for the user whose id is `userIdSql` (e.g. "u.id"). */
export function userUniversityIdSql(userIdSql: string): string {
  return `(SELECT a.id FROM (
      SELECT CASE WHEN r.responses ->> (f.field ->> 'key') ~ '^[0-9]{1,9}$'
                  THEN (r.responses ->> (f.field ->> 'key'))::integer END AS id,
             r.updated_at
        FROM application_responses r
        JOIN application_form_versions fv ON fv.id = r.application_form_version_id
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(fv.template) = 'array' THEN fv.template ELSE '[]'::jsonb END
        ) AS f(field)
       WHERE r.user_id = ${userIdSql} AND f.field ->> 'kind' = 'university') a
     WHERE a.id IS NOT NULL ORDER BY a.updated_at DESC LIMIT 1)`;
}
